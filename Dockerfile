# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory in container
WORKDIR /app

# Install dependencies for audio processing
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg \
    opus-dev \
    curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S discord -u 1001

# Change ownership of app directory
RUN chown -R discord:nodejs /app

# Switch to non-root user
USER discord

# Expose port (if using health check server)
EXPOSE 3000

# Health check (uses PORT environment variable for Render compatibility)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD sh -c 'curl -fsS http://127.0.0.1:${PORT:-3000}/health || exit 1'

# Start the application
CMD ["node", "index.js"]