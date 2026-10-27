# syntax=docker/dockerfile:1

# Web image for the static placeholder client.
#
# nginx:alpine starts a root master process by default. To honour the non-root
# requirement the default configuration is replaced by a minimal one that runs
# entirely as the unprivileged `nginx` user: it listens on 8080 (ports below
# 1024 need privileges), keeps runtime state under /tmp and logs to the
# container streams. The container port is 8080; Compose publishes it as 8080
# on the host.

FROM nginx:alpine AS runtime

RUN cat > /etc/nginx/nginx.conf <<'NGINX_CONF'
worker_processes auto;
pid /tmp/nginx.pid;
error_log /dev/stderr warn;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /dev/stdout;

    client_body_temp_path /tmp/client_body;
    proxy_temp_path /tmp/proxy;
    fastcgi_temp_path /tmp/fastcgi;
    uwsgi_temp_path /tmp/uwsgi;
    scgi_temp_path /tmp/scgi;

    sendfile on;
    keepalive_timeout 65;

    server {
        listen 8080;
        server_name _;
        root /usr/share/nginx/html;
        index index.html;

        # Container-local liveness probe; the public API health endpoints live
        # in the API image.
        location = /healthz {
            access_log off;
            return 200 "ok\n";
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
NGINX_CONF

COPY apps/web/public /usr/share/nginx/html

# nginx:alpine ships tzdata, so access and error log timestamps follow the
# America/Lima decision (plan §2) without an extra package.
ENV TZ=America/Lima

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
