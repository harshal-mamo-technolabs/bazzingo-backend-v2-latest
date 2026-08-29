#!/bin/bash

# Ensure log directory has proper permissions
chown -R node:node /logs
chmod -R 777 /logs

# Ensure application directory has proper permissions
chown -R node:node /var/www/html

exec /usr/bin/supervisord -n -c /etc/supervisord.conf