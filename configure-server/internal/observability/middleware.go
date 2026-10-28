package observability

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"

	"configure-server/internal/consts"
)

// Middleware 记录 API 请求日志与指标；可观测接口自身跳过，避免递归。
func Middleware(r *ghttp.Request) {
	path := r.URL.Path
	if r.Method == http.MethodOptions ||
		!strings.HasPrefix(path, "/api/") ||
		strings.HasPrefix(path, "/api/v1/observability") {
		r.Middleware.Next()
		return
	}

	start := time.Now()
	InFlightAdd(1)
	defer InFlightAdd(-1)

	r.Middleware.Next()

	dur := time.Since(start)
	route := r.Router.Uri
	if route == "" {
		route = path
	}
	status := r.Response.Status
	if status == 0 {
		status = http.StatusOK
	}
	method := r.Method
	durationMs := float64(dur.Microseconds()) / 1000

	ObserveRequest(method, route, status, dur)

	level := LevelInfo
	if status >= 500 {
		level = LevelError
	} else if status >= 400 {
		level = LevelWarn
	}
	Emit(Entry{
		Level:      level,
		Source:     SourceAccess,
		Message:    fmt.Sprintf("%s %s %d · %.1fms", method, route, status, durationMs),
		Method:     method,
		Path:       route,
		Status:     status,
		DurationMs: durationMs,
		User:       r.GetCtxVar(consts.CtxUsername).String(),
		IP:         r.GetClientIp(),
	})
}
