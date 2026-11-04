#!/bin/sh
# The apps are opened at http://localhost:<port> like on the developer's machine: secure cookies and CORS
# both expect localhost. Forward those ports to the compose services.
socat TCP-LISTEN:3000,fork,reuseaddr TCP:web:3000 &
socat TCP-LISTEN:3001,fork,reuseaddr TCP:backend:3001 &
socat TCP-LISTEN:5173,fork,reuseaddr TCP:mobile:80 &
sleep 1
[ $# -eq 0 ] && set -- record.mjs
exec node "$@"
