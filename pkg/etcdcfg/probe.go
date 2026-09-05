package etcdcfg

import (
	"context"
	"fmt"

	"github.com/gogf/gf/v2/frame/g"
)

const (
	StatusOK       = "ok"
	StatusDegraded = "degraded"
	ProbeSkipped   = "skipped"
)

// ProbeResult 供 GET /health 与自定义探活复用。
// Database / Redis 仅在合并配置里存在对应根 key 时探测，未配置则为 skipped。
type ProbeResult struct {
	Status     string `json:"status" dc:"ok | degraded"`
	Service    string `json:"service"`
	Etcd       string `json:"etcd"`
	ConfigFrom string `json:"configFrom" dc:"etcd | snapshot | file"`
	Database   string `json:"database"`
	Redis      string `json:"redis"`
}

// Probe 探测 etcd 配置源，以及可选的 database / redis。
func Probe(ctx context.Context) ProbeResult {
	res := ProbeResult{
		Status:     StatusOK,
		Etcd:       StatusOK,
		ConfigFrom: "file",
		Database:   ProbeSkipped,
		Redis:      ProbeSkipped,
	}

	if a, ok := Current(); ok {
		info := a.RuntimeInfo()
		res.Service = a.ServiceName()
		res.ConfigFrom = info.Source
		if err := a.Ping(ctx); err != nil {
			res.Status = StatusDegraded
			res.Etcd = err.Error()
		}
		if info.Source == SourceSnapshot {
			res.Status = StatusDegraded
		}
	} else if !g.Cfg().Available(ctx) {
		res.Status = StatusDegraded
		res.Etcd = "config adapter unavailable"
	}

	if hasRoot(ctx, "database") {
		res.Database = StatusOK
		if err := safeCall(func() error { return g.DB().PingMaster() }); err != nil {
			res.Status = StatusDegraded
			res.Database = err.Error()
		}
	}
	if hasRoot(ctx, "redis") {
		res.Redis = StatusOK
		if err := safeCall(func() error {
			_, e := g.Redis().Do(ctx, "PING")
			return e
		}); err != nil {
			res.Status = StatusDegraded
			res.Redis = err.Error()
		}
	}
	return res
}

func hasRoot(ctx context.Context, key string) bool {
	v, err := g.Cfg().Get(ctx, key)
	if err != nil || v == nil {
		return false
	}
	return !v.IsEmpty() && !v.IsNil()
}

func safeCall(fn func() error) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("%v", rec)
		}
	}()
	return fn()
}
