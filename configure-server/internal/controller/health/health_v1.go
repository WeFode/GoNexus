package health

import (
	"context"

	v1 "configure-server/api/health/v1"
	"configure-server/utility/etcdx"
)

type ControllerV1 struct{}

func NewV1() *ControllerV1 {
	return &ControllerV1{}
}

func (c *ControllerV1) Health(ctx context.Context, _ *v1.HealthReq) (res *v1.HealthRes, err error) {
	res = &v1.HealthRes{Status: "ok", Etcd: "ok"}
	if perr := etcdx.Client().Ping(ctx); perr != nil {
		res.Status = "degraded"
		res.Etcd = perr.Error()
	}
	return res, nil
}
