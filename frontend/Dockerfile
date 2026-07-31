# 步骤 1: 构建阶段 (Node环境)
FROM node:18-alpine as build-stage

WORKDIR /app

# 先复制 package.json 和 package-lock.json 缓存依赖层
COPY package*.json ./
RUN npm install

# 复制其余代码并进行生产打包
COPY . .
RUN npm run build

# 步骤 2: 生产服务器 (Nginx环境)
FROM nginx:stable-alpine as production-stage

# 从构建阶段复制打包好的 dist 文件到 nginx 默认托管目录
COPY --from=build-stage /app/dist /usr/share/nginx/html

# 复制自定义 Nginx 配置替换默认配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
