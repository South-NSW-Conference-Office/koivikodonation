# give.koivikko.org donation page as a container for snswserver.
# Build from the project root:  docker build -f deploy/snsw/Dockerfile -t koivikko-give .
#
# nginx-unprivileged runs as a normal user (uid 101) and listens on 8080, so the container
# needs no root and no extra Linux capabilities. Only site/ is copied in: the backend, tests
# and docs never end up in the image.
FROM nginxinc/nginx-unprivileged:1.28-alpine

COPY deploy/snsw/site.conf /etc/nginx/conf.d/default.conf
COPY deploy/snsw/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --chown=root:root site/ /usr/share/nginx/html/

USER root
# Not part of the live site:
#  - _headers is Cloudflare's header file (the same rules live in security-headers.conf)
#  - checkout-mock.* is the demo checkout preview, only used by the offline mockup
RUN rm -f /usr/share/nginx/html/_headers \
          /usr/share/nginx/html/checkout-mock.html \
          /usr/share/nginx/html/checkout-mock.js \
 && find /usr/share/nginx/html -type d -exec chmod 755 {} + \
 && find /usr/share/nginx/html -type f -exec chmod 644 {} + \
 && nginx -t
USER 101

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
