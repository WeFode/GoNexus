package auth

import (
	"context"

	v1 "configure-server/api/auth/v1"
)

type IAuthV1 interface {
	Login(ctx context.Context, req *v1.LoginReq) (res *v1.LoginRes, err error)
	Me(ctx context.Context, req *v1.MeReq) (res *v1.MeRes, err error)
}
