ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY apk-packages.txt /build/apk-packages.txt
# Every package is pinned exactly. A line "ARCH:name=version" replaces that
# package's pin on ARCH only (Alpine's architectures can be a revision apart
# while a builder catches up); it must name a pinned package.
RUN awk -v arch="$(apk --print-arch)" ' \
      index($0, ":") { split($0, p, ":"); if (p[1] == arch) { n = p[2]; sub(/=.*/, "", n); over[n] = p[2] }; next }; \
      { n = $0; sub(/=.*/, "", n); order[++count] = n; pin[n] = $0 }; \
      END { for (n in over) if (!(n in pin)) { print "override " over[n] " names no pinned package" > "/dev/stderr"; exit 1 }; \
            for (i = 1; i <= count; i++) print (order[i] in over) ? over[order[i]] : pin[order[i]] }' \
      /build/apk-packages.txt > /tmp/selected && \
    xargs apk add --no-cache < /tmp/selected
# Release source archives also contain the retained dependency archives/patches.
COPY . /build/
WORKDIR /build
RUN bash build.sh
