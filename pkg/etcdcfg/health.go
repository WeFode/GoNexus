package etcdcfg

import (
	"context"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
)

// HealthReq 标准探活。任意 GoFrame 服务 Bind 后即可被中台 / 负载均衡使用。
type HealthReq struct {
	g.Meta `path:"/health" method:"get" tags:"System" summary:"健康检查（etcd 配置；database/redis 有配置才探测）"`
}

// HealthRes 与 ProbeResult 字段对齐，便于各服务统一契约。
type HealthRes struct {
	Status     string `json:"status" dc:"ok | degraded"`
	Service    string `json:"service"`
	Etcd       string `json:"etcd"`
	ConfigFrom string `json:"configFrom" dc:"etcd | snapshot | file"`
	Database   string `json:"database"`
	Redis      string `json:"redis"`
}

// Health 可直接 group.Bind(etcdcfg.NewHealth())。
type Health struct{}

func NewHealth() *Health {
	return &Health{}
}

func (h *Health) Health(ctx context.Context, _ *HealthReq) (*HealthRes, error) {
	p := Probe(ctx)
	return &HealthRes{
		Status:     p.Status,
		Service:    p.Service,
		Etcd:       p.Etcd,
		ConfigFrom: p.ConfigFrom,
		Database:   p.Database,
		Redis:      p.Redis,
	}, nil
}

// BindHealth 在已有 RouterGroup 上挂 GET /health。
// group 需已使用 ghttp.MiddlewareHandlerResponse（与业务 API 同一组即可）。
func BindHealth(group *ghttp.RouterGroup) {
	group.Bind(NewHealth())
}
