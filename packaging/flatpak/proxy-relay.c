/* ShadowCode allow-list relay for Flatpak host commands.
 *
 * Runs inside a host bubblewrap sandbox created with --unshare-net, so the
 * only interface is loopback. It listens on 127.0.0.1:PORT and forwards each
 * connection to SOCKET, a Unix socket served by ShadowCode's allow-list proxy
 * inside the Flatpak. The relay makes no policy decision: the network
 * namespace is what keeps every other route closed, and the proxy decides
 * which hosts are reached.
 *
 * Fails closed: if the loopback listener or the proxy socket is unavailable,
 * the command is not started and the relay exits with status 125.
 *
 * Usage: shadowcode-proxy-relay SOCKET PORT PROGRAM [ARG...]
 */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

#define REFUSED 125

static int refuse(const char *what) {
    fprintf(stderr, "ShadowCode sandbox: the allow-list relay could not start (%s: %s); the command did not run.\n",
            what, strerror(errno));
    return REFUSED;
}

static int connect_proxy(const char *path) {
    struct sockaddr_un address = {0};
    address.sun_family = AF_UNIX;
    if (strlen(path) >= sizeof address.sun_path) { errno = ENAMETOOLONG; return -1; }
    strcpy(address.sun_path, path);
    int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (fd < 0) return -1;
    if (connect(fd, (struct sockaddr *)&address, sizeof address) < 0) {
        int saved = errno;
        close(fd);
        errno = saved;
        return -1;
    }
    return fd;
}

/* Copy both directions until both sides have finished. */
static void pump(int a, int b) {
    char buffer[65536];
    int open_ab = 1, open_ba = 1;
    while (open_ab || open_ba) {
        struct pollfd fds[] = {{open_ab ? a : -1, POLLIN, 0}, {open_ba ? b : -1, POLLIN, 0}};
        if (poll(fds, 2, -1) < 0) { if (errno == EINTR) continue; return; }
        for (int i = 0; i < 2; i++) {
            if (!fds[i].revents) continue;
            int from = i ? b : a, to = i ? a : b;
            ssize_t count = read(from, buffer, sizeof buffer);
            if (count <= 0) {
                shutdown(to, SHUT_WR);
                if (i) open_ba = 0; else open_ab = 0;
                continue;
            }
            for (ssize_t done = 0; done < count;) {
                ssize_t wrote = write(to, buffer + done, (size_t)(count - done));
                if (wrote < 0) { if (errno == EINTR) continue; return; }
                done += wrote;
            }
        }
    }
}

int main(int argc, char **argv) {
    if (argc < 4) {
        fputs("Usage: shadowcode-proxy-relay SOCKET PORT PROGRAM [ARG...]\n", stderr);
        return REFUSED;
    }
    const char *socket_path = argv[1];
    char *end = NULL;
    long port = strtol(argv[2], &end, 10);
    if (!*argv[2] || *end || port < 1 || port > 65535) {
        fputs("ShadowCode sandbox: invalid relay port; the command did not run.\n", stderr);
        return REFUSED;
    }
    signal(SIGPIPE, SIG_IGN);

    int listener = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
    if (listener < 0) return refuse("socket");
    int yes = 1;
    setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof yes);
    struct sockaddr_in local = {0};
    local.sin_family = AF_INET;
    local.sin_port = htons((uint16_t)port);
    local.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(listener, (struct sockaddr *)&local, sizeof local) < 0) return refuse("loopback listener");
    if (listen(listener, 64) < 0) return refuse("listen");

    /* Prove the proxy is reachable before the command can run. */
    int probe = connect_proxy(socket_path);
    if (probe < 0) return refuse("proxy socket");
    close(probe);

    pid_t command = fork();
    if (command < 0) return refuse("fork");
    if (command == 0) {
        execvp(argv[3], argv + 3);
        perror(argv[3]);
        _exit(127);
    }
    for (;;) {
        int status;
        pid_t done;
        while ((done = waitpid(-1, &status, WNOHANG)) > 0) {
            if (done == command)
                return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
        }
        struct pollfd fds[] = {{listener, POLLIN, 0}};
        if (poll(fds, 1, 50) <= 0) continue;
        int client = accept4(listener, NULL, NULL, SOCK_CLOEXEC);
        if (client < 0) continue;
        pid_t worker = fork();
        if (worker == 0) {
            close(listener);
            int upstream = connect_proxy(socket_path);
            if (upstream >= 0) pump(client, upstream);
            _exit(0);
        }
        close(client);
    }
}
