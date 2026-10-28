package cmd

import "github.com/gogf/gf/v2/net/ghttp"

// redoc 官方 CDN 的 redoc.standalone.js 已是 ESM，按普通 script 加载会报
// "Cannot use 'import.meta' outside a module"，离线环境也无法访问。
// 这里改用 GoFrame 内置并在 swaggerPath 下提供的 Redoc 资源。
const swaggerUITemplate = `
<!DOCTYPE html>
<html>
	<head>
	<title>API Reference</title>
	<meta charset="utf-8"/>
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<style>
		body {
			margin:  0;
			padding: 0;
		}
	</style>
	</head>
	<body>
		<redoc spec-url="{SwaggerUIDocUrl}" show-object-schema-examples="true"></redoc>
		<script src="/swagger/redoc.standalone.js"></script>
	</body>
</html>
`

func setupSwaggerUI(s *ghttp.Server) {
	s.SetSwaggerUITemplate(swaggerUITemplate)
}
