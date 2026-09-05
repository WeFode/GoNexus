package v1

import "github.com/gogf/gf/v2/frame/g"

type HealthReq struct {
	g.Meta `path:"/health" method:"get" tags:"System" summary:"健康检查（etcd）"`
}

type HealthRes struct {
	Status string `json:"status" dc:"ok | degraded"`
	Etcd   string `json:"etcd"`
}
