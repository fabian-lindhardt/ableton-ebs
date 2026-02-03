FROM node:20-slim

WORKDIR /app

# Copy package files from ebs directory
COPY ebs/package*.json ./
RUN npm install --production

# Copy ebs source
COPY ebs/ .

# Copy frontend assets to where server.js expects them (../../frontend relative to ebs context or ../frontend)
# server.js uses app.use(express.static('../frontend'));
COPY frontend/ ../frontend/

EXPOSE 8080

CMD ["npm", "start"]
