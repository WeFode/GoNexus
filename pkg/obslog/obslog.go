// Package obslog 为微服务提供轻量日志采集：拦截 g.Log() 与 HTTP 访问日志，
// 批量上报到 configure-server，供中台在线查看（类似 tail -f）。
package obslog

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
	"github.com/gogf/gf/v2/os/glog"
)

const (
	flushInterval   = time.Second
	heartbeatPeriod = 30 * time.Second
	maxBatchSize    = 100
	maxQueueSize    = 2000
	maxMessageRunes = 2000
	requestTimeout  = 3 * time.Second
)

// Entry 是上报到 configure-server 的日志条目。
type Entry struct {
	Ts         int64   `json:"ts,omitempty"`
	Level      string  `json:"level"`
	Source     string  `json:"source"`
	Message    string  `json:"message"`
	Method     string  `json:"method,omitempty"`
	Path       string  `json:"path,omitempty"`
	Status     int     `json:"status,omitempty"`
	DurationMs float64 `json:"durationMs,omitempty"`
	IP         string  `json:"ip,omitempty"`
}

type payload struct {
	Service   string  `json:"service"`
	Heartbeat bool    `json:"heartbeat,omitempty"`
	Entries   []Entry `json:"entries,omitempty"`
}

// Client 负责采集并异步上报日志。未配置 OBS_ENDPOINT / OBS_TOKEN 时为空实现。
type Client struct {
	service  string
	endpoint string
	token    string
	http     *http.Client

	mu       sync.Mutex
	queue    []Entry
	lastSent time.Time
	retryAt  time.Time
	backoff  time.Duration

	done      chan struct{}
	closeOnce sync.Once
	wg        sync.WaitGroup
}

// Setup 从环境变量读取上报配置并启动采集：
//
//	OBS_ENDPOINT  configure-server 地址，如 http://127.0.0.1:9000
//	OBS_TOKEN     上报令牌（对应 configure-server 的 auth.observabilityToken，与 agentToken 分开）
//	OBS_ENABLED   设为 false 可强制关闭
func Setup(service string) *Client {
	c := &Client{
		service:  service,
		endpoint: strings.TrimRight(strings.TrimSpace(os.Getenv("OBS_ENDPOINT")), "/"),
		token:    strings.TrimSpace(os.Getenv("OBS_TOKEN")),
		http:     &http.Client{Timeout: requestTimeout},
		done:     make(chan struct{}),
	}
	if strings.EqualFold(os.Getenv("OBS_ENABLED"), "false") || !c.Enabled() {
		return c
	}
	c.installLogHook()
	c.wg.Add(1)
	go c.loop()
	return c
}

func (c *Client) Enabled() bool {
	return c != nil && c.endpoint != "" && c.token != ""
}

func (c *Client) installLogHook() {
	c.AttachLogger(g.Log())
}

// AttachLogger 把采集钩子挂到指定 logger 上；ghttp 的 server logger 是独立实例，
// 需要在 g.Server() 之后额外挂一次，才能收到框架自身的启动与错误日志。
func (c *Client) AttachLogger(logger *glog.Logger) {
	if !c.Enabled() || logger == nil {
		return
	}
	logger.SetHandlers(func(ctx context.Context, in *glog.HandlerInput) {
		msg := strings.TrimSpace(in.ValuesContent())
		if msg == "" {
			msg = strings.TrimSpace(in.Content)
		}
		if msg != "" && !isRouteTable(msg) {
			c.Emit(Entry{
				Ts:      time.Now().UnixMilli(),
				Level:   levelFromFormat(in.LevelFormat),
				Source:  "server",
				Message: msg,
			})
		}
		in.Next(ctx)
	})
}

// Middleware 把服务自身的 API 请求记为访问日志，无需经过网关。
func (c *Client) Middleware(r *ghttp.Request) {
	if !c.Enabled() {
		r.Middleware.Next()
		return
	}
	path := r.URL.Path
	if r.Method == http.MethodOptions || !strings.HasPrefix(path, "/api/") {
		r.Middleware.Next()
		return
	}

	start := time.Now()
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
	ms := float64(dur.Microseconds()) / 1000
	level := "info"
	if status >= 500 {
		level = "error"
	} else if status >= 400 {
		level = "warn"
	}
	c.Emit(Entry{
		Ts:         time.Now().UnixMilli(),
		Level:      level,
		Source:     "access",
		Message:    fmt.Sprintf("%s %s %d · %.1fms", r.Method, route, status, ms),
		Method:     r.Method,
		Path:       route,
		Status:     status,
		DurationMs: ms,
		IP:         r.GetClientIp(),
	})
}

func (c *Client) Emit(e Entry) {
	if !c.Enabled() {
		return
	}
	if e.Level == "" {
		e.Level = "info"
	}
	if e.Source == "" {
		e.Source = "server"
	}
	if e.Ts <= 0 {
		e.Ts = time.Now().UnixMilli()
	}
	e.Message = truncate(e.Message)
	if e.Message == "" {
		return
	}

	c.mu.Lock()
	if len(c.queue) >= maxQueueSize {
		c.queue = append([]Entry(nil), c.queue[len(c.queue)-maxQueueSize+1:]...)
	}
	c.queue = append(c.queue, e)
	c.mu.Unlock()
}

func (c *Client) loop() {
	defer c.wg.Done()
	ticker := time.NewTicker(flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			c.flush(true)
			return
		case <-ticker.C:
			c.flush(false)
		}
	}
}

func (c *Client) flush(force bool) {
	c.mu.Lock()
	if !force && time.Now().Before(c.retryAt) {
		c.mu.Unlock()
		return
	}
	n := len(c.queue)
	if n > maxBatchSize {
		n = maxBatchSize
	}
	var (
		entries   []Entry
		heartbeat bool
	)
	if n > 0 {
		entries = append([]Entry(nil), c.queue[:n]...)
		c.queue = append([]Entry(nil), c.queue[n:]...)
	} else {
		if !force && time.Since(c.lastSent) < heartbeatPeriod {
			c.mu.Unlock()
			return
		}
		heartbeat = true
	}
	c.mu.Unlock()

	if err := c.post(entries, heartbeat); err != nil {
		c.mu.Lock()
		if len(entries) > 0 {
			c.queue = append(entries, c.queue...)
			if len(c.queue) > maxQueueSize {
				c.queue = append([]Entry(nil), c.queue[len(c.queue)-maxQueueSize:]...)
			}
		}
		if c.backoff == 0 {
			c.backoff = 2 * time.Second
		} else if c.backoff < heartbeatPeriod {
			c.backoff *= 2
		}
		c.retryAt = time.Now().Add(c.backoff)
		c.mu.Unlock()
		return
	}

	c.mu.Lock()
	c.lastSent = time.Now()
	c.backoff = 0
	c.retryAt = time.Time{}
	c.mu.Unlock()
}

func (c *Client) post(entries []Entry, heartbeat bool) error {
	body, err := json.Marshal(payload{Service: c.service, Entries: entries, Heartbeat: heartbeat})
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.endpoint+"/api/v1/observability/ingest", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Obs-Token", c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("log ingest failed: status %d", resp.StatusCode)
	}
	return nil
}

// Close 停止采集并尽力完成最后一次上报。
func (c *Client) Close() {
	if !c.Enabled() {
		return
	}
	c.closeOnce.Do(func() { close(c.done) })
	c.wg.Wait()
}

// isRouteTable 过滤 GoFrame 启动时打印的路由表，避免大段多行文本刷屏。
func isRouteTable(msg string) bool {
	return strings.HasPrefix(msg, "----------|") && strings.Contains(msg, "| ADDRESS | METHOD |")
}

func levelFromFormat(format string) string {
	switch format {
	case "DEBU":
		return "debug"
	case "INFO", "NOTI":
		return "info"
	case "WARN":
		return "warn"
	case "ERRO", "CRIT", "PANI", "FATA":
		return "error"
	default:
		return "info"
	}
}

func truncate(s string) string {
	runes := []rune(strings.TrimSpace(s))
	if len(runes) <= maxMessageRunes {
		return string(runes)
	}
	return string(runes[:maxMessageRunes]) + "…"
}
