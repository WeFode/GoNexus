package observability

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/net/ghttp"

	v1 "configure-server/api/observability/v1"
	obsv "configure-server/internal/observability"
)

type ControllerV1 struct{}

func NewV1() *ControllerV1 {
	return &ControllerV1{}
}

func (c *ControllerV1) Overview(_ context.Context, _ *v1.OverviewReq) (*v1.OverviewRes, error) {
	snap := obsv.MetricsSnapshot()
	res := &v1.OverviewRes{
		RequestTotal: snap.RequestTotal,
		InFlight:     snap.InFlight,
		ErrorRate:    snap.ErrorRate,
		AvgMs:        snap.AvgMs,
		P95Ms:        snap.P95Ms,
		RPS:          snap.RPS,
		Statuses:     make([]v1.StatusStat, 0, len(snap.Statuses)),
		Routes:       make([]v1.RouteStat, 0, len(snap.Routes)),
		Minutes:      make([]v1.MinutePoint, 0, len(snap.Minutes)),
		Buffer: v1.BufferStat{
			Capacity: snap.Buffer.Capacity,
			Size:     snap.Buffer.Size,
			Total:    snap.Buffer.Total,
			Clients:  snap.Buffer.Clients,
		},
		Runtime: v1.RuntimeStat{
			GoVersion:   snap.Runtime.GoVersion,
			NumCPU:      snap.Runtime.NumCPU,
			Goroutines:  snap.Runtime.Goroutines,
			HeapAllocMB: snap.Runtime.HeapAllocMB,
			HeapInuseMB: snap.Runtime.HeapInuseMB,
			SysMB:       snap.Runtime.SysMB,
			NumGC:       snap.Runtime.NumGC,
			StartedAt:   snap.Runtime.StartedAt,
			UptimeSec:   snap.Runtime.UptimeSec,
		},
		GeneratedAt: time.Now().Format("2006-01-02 15:04:05"),
	}
	for _, s := range snap.Statuses {
		res.Statuses = append(res.Statuses, v1.StatusStat{Key: s.Key, Count: s.Count})
	}
	for _, r := range snap.Routes {
		res.Routes = append(res.Routes, v1.RouteStat{
			Method: r.Method,
			Route:  r.Route,
			Count:  r.Count,
			Errors: r.Errors,
			AvgMs:  r.AvgMs,
		})
	}
	for _, p := range snap.Minutes {
		res.Minutes = append(res.Minutes, v1.MinutePoint{
			Minute: p.Minute,
			Total:  p.Total,
			Errors: p.Errors,
			AvgMs:  p.AvgMs,
			P95Ms:  p.P95Ms,
		})
	}
	return res, nil
}

func (c *ControllerV1) Logs(_ context.Context, req *v1.LogsReq) (*v1.LogsRes, error) {
	items, lastId := obsv.Query(obsv.Filter{
		Level:   req.Level,
		Source:  req.Source,
		Service: req.Service,
		Keyword: req.Keyword,
		Limit:   req.Limit,
		AfterId: req.AfterId,
	})
	res := &v1.LogsRes{
		Items:    make([]v1.LogItem, 0, len(items)),
		LastId:   lastId,
		Sources:  obsv.Sources(),
		Services: serviceItems(),
	}
	for _, e := range items {
		res.Items = append(res.Items, v1.LogItem{
			Id:         e.Id,
			Ts:         e.Ts,
			Time:       e.Time,
			Level:      e.Level,
			Source:     e.Source,
			Service:    e.Service,
			Message:    e.Message,
			Method:     e.Method,
			Path:       e.Path,
			Status:     e.Status,
			DurationMs: e.DurationMs,
			User:       e.User,
			IP:         e.IP,
			NodeId:     e.NodeId,
			JobId:      e.JobId,
			Action:     e.Action,
		})
	}
	return res, nil
}

func (c *ControllerV1) Services(_ context.Context, _ *v1.ServicesReq) (*v1.ServicesRes, error) {
	return &v1.ServicesRes{Items: serviceItems()}, nil
}

var serviceNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)

// Ingest 接收微服务 SDK 批量上报的日志，按服务名打标后进入统一日志缓冲。
func (c *ControllerV1) Ingest(_ context.Context, req *v1.IngestReq) (*v1.IngestRes, error) {
	service := strings.TrimSpace(req.Service)
	if !serviceNamePattern.MatchString(service) {
		return nil, gerror.New("service 名称不合法")
	}
	if len(req.Entries) > 500 {
		return nil, gerror.New("单批日志不能超过 500 条")
	}
	obsv.TouchService(service)
	accepted := 0
	for _, in := range req.Entries {
		msg := strings.TrimSpace(in.Message)
		if msg == "" {
			continue
		}
		ts := in.Ts
		if ts < 0 {
			ts = 0
		}
		obsv.Emit(obsv.Entry{
			Ts:         ts,
			Level:      obsv.NormalizeLevel(in.Level),
			Source:     obsv.NormalizeSource(in.Source),
			Service:    service,
			Message:    msg,
			Method:     in.Method,
			Path:       in.Path,
			Status:     in.Status,
			DurationMs: in.DurationMs,
			IP:         in.IP,
		})
		accepted++
	}
	return &v1.IngestRes{Accepted: accepted}, nil
}

func serviceItems() []v1.ServiceItem {
	stats := obsv.ServiceStats()
	out := make([]v1.ServiceItem, 0, len(stats))
	for _, s := range stats {
		out = append(out, v1.ServiceItem{
			Name:   s.Name,
			Count:  s.Count,
			LastTs: s.LastTs,
			SeenAt: s.SeenAt,
		})
	}
	return out
}

// Stream 通过 SSE 推送实时日志。EventSource 无法设置请求头，支持 ?token= 鉴权与 ?lastId= 断点续传。
func Stream(r *ghttp.Request) {
	lastId := int64(0)
	if v := strings.TrimSpace(r.Get("lastId").String()); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			lastId = n
		}
	}
	// 浏览器自动重连时会带上 Last-Event-ID，优先于首连的查询参数。
	if v := strings.TrimSpace(r.Header.Get("Last-Event-ID")); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			lastId = n
		}
	}

	header := r.Response.Header()
	header.Set("Content-Type", "text/event-stream; charset=utf-8")
	header.Set("Cache-Control", "no-cache, no-transform")
	header.Set("Connection", "keep-alive")
	header.Set("X-Accel-Buffering", "no")
	r.Response.WriteHeader(http.StatusOK)

	if lastId > 0 {
		items, _ := obsv.Query(obsv.Filter{AfterId: lastId, Limit: 300})
		for _, e := range items {
			writeSSE(r, e)
			lastId = e.Id
		}
	}
	_, _ = r.Response.WriteString("retry: 2000\n\n")
	r.Response.Flush()

	subId, ch := obsv.Subscribe()
	defer obsv.Unsubscribe(subId)

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ping.C:
			_, _ = r.Response.WriteString(": ping\n\n")
			r.Response.Flush()
		case e := <-ch:
			if e.Id <= lastId {
				continue
			}
			writeSSE(r, e)
			lastId = e.Id
		}
	}
}

func writeSSE(r *ghttp.Request, e obsv.Entry) {
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	_, _ = r.Response.WriteString(fmt.Sprintf("id: %d\ndata: %s\n\n", e.Id, data))
	r.Response.Flush()
}
