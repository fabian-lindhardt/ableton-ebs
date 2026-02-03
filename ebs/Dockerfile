FROM node:20-slim

WORKDIR /app

# Copy package files from ebs directory
COPY ebs/package*.json ./
RUN npm install --production

# Copy ebs source
COPY ebs/ .

# Copy frontend assets to public/
COPY frontend/ public/

EXPOSE 8080

CMD ["npm", "start"]
