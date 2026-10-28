package auth

import (
	"context"

	v1 "configure-server/api/auth/v1"
	"configure-server/internal/consts"
	obsv "configure-server/internal/observability"
	"configure-server/utility/authx"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
)

type ControllerV1 struct{}

func NewV1() *ControllerV1 {
	return &ControllerV1{}
}

func (c *ControllerV1) Login(ctx context.Context, req *v1.LoginReq) (*v1.LoginRes, error) {
	token, exp, p, err := authx.Login(ctx, req.Username, req.Password)
	if err != nil {
		obsv.Emit(obsv.Entry{
			Level: obsv.LevelWarn, Source: obsv.SourceAuth, Action: "login-failed",
			User: req.Username, IP: clientIP(ctx),
			Message: "登录失败：" + req.Username + "（" + err.Error() + "）",
		})
		return nil, err
	}
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceAuth, Action: "login",
		User: p.Username, IP: clientIP(ctx),
		Message: "登录成功：" + p.Username + "（" + p.Role + "）",
	})
	return &v1.LoginRes{
		Token:    token,
		ExpireAt: exp.Format("2006-01-02 15:04:05"),
		Username: p.Username,
		Role:     p.Role,
	}, nil
}

func clientIP(ctx context.Context) string {
	if r := g.RequestFromCtx(ctx); r != nil {
		return r.GetClientIp()
	}
	return ""
}

func (c *ControllerV1) Me(ctx context.Context, _ *v1.MeReq) (*v1.MeRes, error) {
	r := g.RequestFromCtx(ctx)
	username := r.GetCtxVar(consts.CtxUsername).String()
	if username == "" {
		return nil, gerror.New("未登录")
	}
	return &v1.MeRes{
		Username: username,
		Role:     r.GetCtxVar(consts.CtxRole).String(),
	}, nil
}
