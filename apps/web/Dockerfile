# syntax=docker/dockerfile:1

# Build the public site (Astro, served at /) and the ERP client (React SPA, served at
# /app), and serve only their static output from the runtime image.
FROM node:22-alpine AS build

# Public site settings, baked in at build time. Empty values keep the visible
# placeholders and leave out canonical URLs and the sitemap host.
ARG SITE_URL=""
ARG PUBLIC_WHATSAPP_NUMBER=""
ENV SITE_URL=$SITE_URL PUBLIC_WHATSAPP_NUMBER=$PUBLIC_WHATSAPP_NUMBER

WORKDIR /workspace
COPY . .
RUN npm ci --workspace=@erp-logistic/web --workspace=@erp-logistic/site --include-workspace-root=true
RUN npm run build --workspace=@erp-logistic/web && npm run build --workspace=@erp-logistic/site

# nginx:alpine runs as the unprivileged nginx user and listens on 8080.
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

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

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
        client_max_body_size 5000000;

        # Container-local liveness probe; the public API health endpoints live
        # in the API image.
        location = /healthz {
            access_log off;
            return 200 "ok\n";
        }

        location /api/ {
            proxy_pass http://api:3000/api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # ERP single-page app: every /app URL boots the same document and the
        # client router picks the screen.
        # Public tracking page for recipients. The link key travels after "#",
        # so it never reaches these logs. Keep it out of caches and search engines.
        location = /seguimiento {
            add_header Cache-Control "no-store" always;
            add_header Referrer-Policy "no-referrer" always;
            add_header X-Robots-Tag "noindex, nofollow" always;
            try_files /seguimiento.html =404;
        }

        location = /app {
            try_files /app.html =404;
        }

        location /app/ {
            try_files $uri /app.html;
        }

        # Public site: prebuilt HTML files (/privacidad -> privacidad.html).
        location / {
            try_files $uri $uri.html $uri/index.html =404;
        }

        error_page 404 /404.html;
    }
}
NGINX_CONF

# The ERP document becomes app.html so the site's index.html can own /. Their
# assets do not collide: Vite emits /assets/*, Astro emits /_astro/*.
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
RUN mv /usr/share/nginx/html/index.html /usr/share/nginx/html/app.html
COPY --from=build /workspace/apps/site/dist /usr/share/nginx/html

# nginx:alpine ships tzdata, so access and error log timestamps follow the
# America/Lima decision (plan §2) without an extra package.
ENV TZ=America/Lima

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
