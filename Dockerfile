FROM node:20-bullseye

# Install Nginx, supervisor, and Puppeteer dependencies
RUN apt-get update && \
    apt-get install -y nginx supervisor \
    # Puppeteer dependencies
    wget gnupg ca-certificates fonts-liberation \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 \
    libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 \
    libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 \
    libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 lsb-release xdg-utils && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create necessary directories including Puppeteer cache
RUN mkdir -p /var/log/supervisor /var/www/html /logs /home/node/.cache/puppeteer /home/node/.config

# Set working directory
WORKDIR /var/www/html

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Copy Nginx and supervisor configurations
COPY ./conf/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY ./conf/supervisor/supervisord.conf /etc/supervisord.conf

# Copy and set permissions for startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Set proper permissions
RUN chown -R node:node /var/www/html && \
    chown -R node:node /logs && \
    chmod -R 777 /logs && \
    chown -R node:node /home/node && \
    chmod -R 755 /home/node

# Remove default Nginx config
RUN rm -f /etc/nginx/sites-enabled/default

# Set Puppeteer environment variables
ENV PUPPETEER_CACHE_DIR=/home/node/.cache/puppeteer \
    XDG_CONFIG_HOME=/home/node/.config \
    HOME=/home/node

# Expose Nginx port
EXPOSE 5025

# Volume for logs
VOLUME /logs

CMD ["/start.sh"]