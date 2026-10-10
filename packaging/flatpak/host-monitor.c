/* Host command ownership across a Flatpak boundary. FD 3 is a read-only
 * liveness pipe: only flatpak-spawn inside the app retains its writer.
 * This small helper is statically linked so it needs no host ABI libraries.
 * SPDX-License-Identifier: Apache-2.0 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

static struct termios outer_mode;
static int restore_outer;
static int outer_flags = -1;
static void restore_terminal(void) {
    if (restore_outer) tcsetattr(STDIN_FILENO, TCSANOW, &outer_mode);
    if (outer_flags >= 0) fcntl(1, F_SETFL, outer_flags);
}

/* A PTY created in Flatpak's devpts belongs to its user namespace. The
 * host cannot claim it as a controlling terminal. Relay to a host PTY so
 * the shell gets normal job control, signals and window resizing. */
static int terminal_pair(int *slave) {
    int master = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC | O_NONBLOCK);
    if (master < 0) return -1;
    if (grantpt(master) < 0 || unlockpt(master) < 0) { close(master); return -1; }
    char *name = ptsname(master);
    if (!name || (*slave = open(name, O_RDWR | O_NOCTTY | O_CLOEXEC)) < 0) {
        close(master); return -1;
    }
    if (tcgetattr(STDIN_FILENO, &outer_mode) < 0 ||
        tcsetattr(*slave, TCSANOW, &outer_mode) < 0) {
        close(master); close(*slave); return -1;
    }
    struct winsize size;
    if (ioctl(STDIN_FILENO, TIOCGWINSZ, &size) == 0) ioctl(master, TIOCSWINSZ, &size);
    struct termios raw = outer_mode;
    cfmakeraw(&raw);
    if (tcsetattr(STDIN_FILENO, TCSANOW, &raw) < 0) {
        close(master); close(*slave); return -1;
    }
    restore_outer = 1;
    atexit(restore_terminal);
    return master;
}

static volatile sig_atomic_t interrupted;
static void remember_signal(int signal) { interrupted = signal; }

static void flush_output(const char *bytes, size_t size) {
    while (size && !interrupted) {
        struct pollfd fds[] = {{1, POLLOUT, 0}, {3, POLLIN | POLLHUP, 0}};
        if (poll(fds, 2, 100) <= 0 || fds[1].revents) return;
        ssize_t count = write(1, bytes, size);
        if (count > 0) { bytes += count; size -= (size_t)count; }
        else if (errno != EINTR && errno != EAGAIN) return;
    }
}

/* Stop each process before walking its children, then kill it. Reaping is
 * deferred, so an owned zombie PID cannot be reused during this traversal. */
static void stop_tree(pid_t pid, unsigned depth) {
    if (pid <= 1 || depth > 256) return;
    if (kill(pid, SIGSTOP) != 0 && errno == ESRCH) return;
    char path[128];
    snprintf(path, sizeof path, "/proc/%ld/task/%ld/children", (long)pid, (long)pid);
    FILE *children = fopen(path, "r");
    if (children) {
        long child;
        while (fscanf(children, "%ld", &child) == 1) stop_tree((pid_t)child, depth + 1);
        fclose(children);
    }
    kill(pid, SIGKILL);
}

static void cleanup(void) {
    /* Orphans are adopted by this subreaper, including jobs which created
     * another session or process group. Repeat to handle concurrent adoption. */
    for (unsigned attempt = 0; attempt < 100; attempt++) {
        char path[128];
        snprintf(path, sizeof path, "/proc/self/task/%ld/children", (long)getpid());
        FILE *children = fopen(path, "r");
        unsigned found = 0;
        if (children) {
            long child;
            while (fscanf(children, "%ld", &child) == 1) {
                found++;
                stop_tree((pid_t)child, 0);
            }
            fclose(children);
        }
        while (waitpid(-1, NULL, WNOHANG) > 0) {}
        if (!found) return;
        struct timespec delay = {0, 10000000};
        nanosleep(&delay, NULL);
    }
}

int main(int argc, char **argv) {
    if (argc < 2 || fcntl(3, F_GETFD) < 0) {
        fputs("ShadowCode host monitor requires a command and liveness FD 3\n", stderr);
        return 64;
    }
    if (prctl(PR_SET_CHILD_SUBREAPER, 1) != 0) { perror("subreaper"); return 1; }
    /* flatpak-spawn also forwards terminal signals to its host command.
     * Own cleanup before exiting, rather than orphaning the real shell. */
    struct sigaction action = {0};
    action.sa_handler = remember_signal;
    sigemptyset(&action.sa_mask);
    for (unsigned i = 0; i < 4; i++) {
        const int signals[] = {SIGHUP, SIGINT, SIGTERM, SIGQUIT};
        if (sigaction(signals[i], &action, NULL) != 0) { perror("sigaction"); return 1; }
    }
    int slave = -1, master = -1;
    if (isatty(STDIN_FILENO) && tcgetsid(STDIN_FILENO) != getsid(0)) {
        master = terminal_pair(&slave);
        if (master < 0) { perror("host terminal"); return 1; }
    }
    pid_t child = fork();
    if (child < 0) { perror("fork"); return 1; }
    if (child == 0) {
        close(3);
        if (master >= 0) {
            close(master);
            for (int fd = 0; fd < 3; fd++) if (dup2(slave, fd) < 0) _exit(126);
            if (slave > 2) close(slave);
        }
        if (isatty(STDIN_FILENO) && tcgetsid(STDIN_FILENO) == getsid(0)) {
            /* HostCommand already made this monitor the terminal owner.
             * Put the shell in its own foreground group in that session. */
            if (setpgid(0, 0) < 0) _exit(126);
            struct sigaction quiet = {0}, normal = {0};
            quiet.sa_handler = SIG_IGN;
            normal.sa_handler = SIG_DFL;
            sigaction(SIGTTOU, &quiet, NULL);
            int foreground = tcsetpgrp(STDIN_FILENO, getpid());
            sigaction(SIGTTOU, &normal, NULL);
            if (foreground < 0) _exit(126);
        } else {
            if (setsid() < 0) _exit(126);
            if (isatty(STDIN_FILENO) && ioctl(0, TIOCSCTTY, 0) < 0) _exit(126);
        }
        execvp(argv[1], argv + 1);
        perror(argv[1]);
        _exit(127);
    }
    if (slave >= 0) close(slave);
    if (master >= 0) {
        int flags = fcntl(1, F_GETFL);
        outer_flags = flags;
        if (flags < 0 || fcntl(1, F_SETFL, flags | O_NONBLOCK) < 0) { cleanup(); return 1; }
    }
    char incoming[65536], outgoing[65536];
    size_t in_size = 0, out_size = 0;
    int input_open = 1, output_open = 1;
    struct winsize previous = {0};
    for (;;) {
        if (interrupted) { cleanup(); return 128 + interrupted; }
        int status;
        pid_t done = waitpid(child, &status, WNOHANG);
        if (done == child) {
            cleanup();
            /* Flush bytes already produced before closing the terminal. */
            if (master >= 0) {
                if (out_size) flush_output(outgoing, out_size);
                ssize_t count;
                while ((count = read(master, outgoing, sizeof outgoing)) > 0)
                    flush_output(outgoing, (size_t)count);
            }
            return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        }
        if (done < 0 && errno != EINTR) { cleanup(); return 1; }
        if (master >= 0) {
            struct winsize size;
            if (ioctl(STDIN_FILENO, TIOCGWINSZ, &size) == 0 &&
                (size.ws_row != previous.ws_row || size.ws_col != previous.ws_col)) {
                ioctl(master, TIOCSWINSZ, &size);
                previous = size;
            }
        }
        struct pollfd fds[] = {
            {3, POLLIN | POLLHUP | POLLERR, 0},
            {master >= 0 && input_open && in_size < sizeof incoming ? STDIN_FILENO : -1, POLLIN, 0},
            {master >= 0 && output_open ? master : -1,
             (short)((out_size < sizeof outgoing ? POLLIN : 0) | (in_size ? POLLOUT : 0)), 0},
            {master >= 0 && out_size ? STDOUT_FILENO : -1, POLLOUT, 0},
        };
        int result = poll(fds, 4, 50);
        if (result < 0 && errno == EINTR) continue;
        if (result < 0 || (fds[0].revents & (POLLHUP | POLLERR))) {
            cleanup(); return 130;
        }
        if (fds[0].revents & POLLIN) {
            char buffer[64];
            if (read(3, buffer, sizeof buffer) <= 0) { cleanup(); return 130; }
        }
        if (fds[1].revents & (POLLIN | POLLHUP)) {
            ssize_t count = read(0, incoming + in_size, sizeof incoming - in_size);
            if (count > 0) in_size += (size_t)count;
            else if (!count || (errno != EINTR && errno != EAGAIN)) input_open = 0;
        }
        if (fds[2].revents & POLLOUT) {
            ssize_t count = write(master, incoming, in_size);
            if (count > 0) {
                in_size -= (size_t)count;
                memmove(incoming, incoming + count, in_size);
            }
        }
        if (fds[2].revents & (POLLIN | POLLHUP)) {
            ssize_t count = read(master, outgoing + out_size, sizeof outgoing - out_size);
            if (count > 0) out_size += (size_t)count;
            else if (!count || (errno != EINTR && errno != EAGAIN)) output_open = 0;
        }
        if (fds[3].revents & POLLOUT) {
            ssize_t count = write(1, outgoing, out_size);
            if (count > 0) {
                out_size -= (size_t)count;
                memmove(outgoing, outgoing + count, out_size);
            } else if (count < 0 && errno != EINTR && errno != EAGAIN) {
                cleanup(); return 130;
            }
        }
    }
}
