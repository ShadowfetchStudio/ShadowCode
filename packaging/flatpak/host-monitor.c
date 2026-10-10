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
#include <sys/ioctl.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t interrupted;
static void remember_signal(int signal) { interrupted = signal; }

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
    pid_t child = fork();
    if (child < 0) { perror("fork"); return 1; }
    if (child == 0) {
        close(3);
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
    struct pollfd control = {3, POLLIN | POLLHUP | POLLERR, 0};
    for (;;) {
        if (interrupted) { cleanup(); return 128 + interrupted; }
        int status;
        pid_t done = waitpid(child, &status, WNOHANG);
        if (done == child) {
            cleanup();
            return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        }
        if (done < 0 && errno != EINTR) { cleanup(); return 1; }
        int result = poll(&control, 1, 50);
        if (result < 0 && errno == EINTR) continue;
        if (result < 0 || (result && (control.revents & (POLLHUP | POLLERR)))) {
            cleanup();
            return 130;
        }
        if (result && (control.revents & POLLIN)) {
            char buffer[64];
            if (read(3, buffer, sizeof buffer) <= 0) { cleanup(); return 130; }
        }
    }
}
