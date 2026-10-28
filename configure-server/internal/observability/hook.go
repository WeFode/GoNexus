package observability

import (
	"context"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/glog"
)

// InstallLogHook 把全局 g.Log() 输出同时写入内存日志缓冲，供前端实时展示。
// 调用 in.Next(ctx) 以保留原有的控制台/文件输出。
func InstallLogHook() {
	InstallLoggerHook(g.Log())
}

// InstallLoggerHook 把日志钩子挂到指定 logger；ghttp 的 server logger 是独立实例，
// 需在 g.Server() 之后额外挂载，才能收集框架启动与请求错误日志。
func InstallLoggerHook(logger *glog.Logger) {
	if logger == nil {
		return
	}
	logger.SetHandlers(func(ctx context.Context, in *glog.HandlerInput) {
		msg := strings.TrimSpace(in.ValuesContent())
		if msg == "" {
			msg = strings.TrimSpace(in.Content)
		}
		if msg == "" || isRouteTable(msg) {
			in.Next(ctx)
			return
		}
		Emit(Entry{
			Level:   levelFromFormat(in.LevelFormat),
			Source:  SourceServer,
			Message: msg,
		})
		in.Next(ctx)
	})
}

// isRouteTable 过滤 GoFrame 启动时打印的路由表，避免大段多行文本刷屏。
func isRouteTable(msg string) bool {
	return strings.HasPrefix(msg, "----------|") && strings.Contains(msg, "| ADDRESS | METHOD |")
}

func levelFromFormat(format string) string {
	switch format {
	case "DEBU":
		return LevelDebug
	case "INFO", "NOTI":
		return LevelInfo
	case "WARN":
		return LevelWarn
	case "ERRO", "CRIT", "PANI", "FATA":
		return LevelError
	default:
		return LevelInfo
	}
}
