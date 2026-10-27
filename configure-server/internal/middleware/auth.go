package middleware

import (
	"net/http"
	"strings"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"configure-server/internal/consts"
	"configure-server/utility/authx"
)

func CORS(r *ghttp.Request) {
	r.Response.CORSDefault()
	r.Middleware.Next()
}

func JWT(r *ghttp.Request) {
	if r.Method == http.MethodOptions {
		r.Middleware.Next()
		return
	}
	path := r.URL.Path
	if path == "/api/v1/auth/login" || path == "/api/v1/health" {
		r.Middleware.Next()
		return
	}
	if strings.HasPrefix(path, "/api/v1/agent/") {
		want := g.Cfg().MustGet(r.Context(), "auth.agentToken").String()
		got := r.Header.Get("X-Agent-Token")
		if got == "" {
			got = strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		}
		if want == "" || got != want {
			r.Response.WriteHeader(http.StatusUnauthorized)
			r.Response.WriteJsonExit(g.Map{"code": 401, "message": "agent token 无效", "data": nil})
			return
		}
		r.SetCtxVar(consts.CtxRole, "agent")
		r.Middleware.Next()
		return
	}

	raw := r.Header.Get("Authorization")
	claims, err := authx.Parse(raw)
	if err != nil {
		r.Response.WriteHeader(http.StatusUnauthorized)
		r.Response.WriteJsonExit(g.Map{
			"code":    401,
			"message": err.Error(),
			"data":    nil,
		})
		return
	}
	r.SetCtxVar(consts.CtxUsername, claims.Username)
	r.SetCtxVar(consts.CtxRole, claims.Role)
	r.Middleware.Next()
}
