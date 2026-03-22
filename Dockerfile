FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install dependencies for the webapp
COPY csv_webapp/package*.json ./csv_webapp/
RUN cd csv_webapp && npm install

# Bundle all app source code and CSV files
COPY . .

# Expose port 3000
ENV PORT=3000
EXPOSE 3000

# Start the server
CMD ["node", "csv_webapp/server.js"]
