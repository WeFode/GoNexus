package cmd

import (
	"context"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/gcmd"

	"configure-server/internal/boot"
	"configure-server/internal/controller/auth"
	"configure-server/internal/controller/config"
	"configure-server/internal/controller/deploy"
	"configure-server/internal/controller/health"
	"configure-server/internal/controller/observability"
	"configure-server/internal/middleware"
	obs "configure-server/internal/observability"
)

var (
	Main = gcmd.Command{
		Name:  "main",
		Usage: "main",
		Brief: "etcd 配置中心",
		Func: func(ctx context.Context, parser *gcmd.Parser) (err error) {
			obs.InstallLogHook()
			if err = boot.Init(ctx); err != nil {
				return err
			}

			s := g.Server()
			obs.InstallLoggerHook(s.Logger())
			setupSwaggerUI(s)
			s.Use(middleware.CORS)
			s.Use(obs.Middleware)

			s.Group("/api/v1", func(group *ghttp.RouterGroup) {
				group.Middleware(middleware.JWT)
				group.GET("/agent/artifacts/{id}/file", deploy.DownloadArtifact)
				group.GET("/observability/logs/stream", observability.Stream)
			})

			s.Group("/api/v1", func(group *ghttp.RouterGroup) {
				group.Middleware(middleware.JWT, ghttp.MiddlewareHandlerResponse)
				group.Bind(
					health.NewV1(),
					auth.NewV1(),
					config.NewV1(),
					deploy.NewV1(),
					observability.NewV1(),
				)
			})

			s.Run()
			return nil
		},
	}
)
