package v1

import "github.com/gogf/gf/v2/frame/g"

type LoginReq struct {
	g.Meta   `path:"/auth/login" method:"post" tags:"Auth" summary:"登录，返回 JWT"`
	Username string `json:"username" v:"required#用户名不能为空"`
	Password string `json:"password" v:"required#密码不能为空"`
}

type LoginRes struct {
	Token    string `json:"token"`
	ExpireAt string `json:"expireAt"`
	Username string `json:"username"`
	Role     string `json:"role" dc:"admin | operator"`
}

type MeReq struct {
	g.Meta `path:"/auth/me" method:"get" tags:"Auth" summary:"当前登录用户"`
}

type MeRes struct {
	Username string `json:"username"`
	Role     string `json:"role"`
}
