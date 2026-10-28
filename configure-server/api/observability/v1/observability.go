package v1

import "github.com/gogf/gf/v2/frame/g"

type OverviewReq struct {
	g.Meta `path:"/observability/overview" method:"get" tags:"Observability" summary:"可观测总览（请求指标 / 运行时 / 日志缓冲）"`
}

type OverviewRes struct {
	RequestTotal int64         `json:"requestTotal" dc:"进程启动以来 API 请求总数"`
	InFlight     int64         `json:"inFlight" dc:"当前处理中的请求数"`
	ErrorRate    float64       `json:"errorRate" dc:"5xx 占比，0~1"`
	AvgMs        float64       `json:"avgMs" dc:"平均耗时（毫秒）"`
	P95Ms        float64       `json:"p95Ms" dc:"P95 耗时（毫秒）"`
	RPS          float64       `json:"rps" dc:"最近 5 分钟平均每秒请求数"`
	Statuses     []StatusStat  `json:"statuses" dc:"HTTP 状态码分布"`
	Routes       []RouteStat   `json:"routes" dc:"最近 30 分钟访问量 Top 路由"`
	Minutes      []MinutePoint `json:"minutes" dc:"最近 30 分钟逐分钟指标"`
	Buffer       BufferStat    `json:"buffer"`
	Runtime      RuntimeStat   `json:"runtime"`
	GeneratedAt  string        `json:"generatedAt"`
}

type StatusStat struct {
	Key   string `json:"key" dc:"2xx | 3xx | 4xx | 5xx"`
	Count int64  `json:"count"`
}

type RouteStat struct {
	Method string  `json:"method"`
	Route  string  `json:"route"`
	Count  int64   `json:"count"`
	Errors int64   `json:"errors" dc:"5xx 次数"`
	AvgMs  float64 `json:"avgMs"`
}

type MinutePoint struct {
	Minute string  `json:"minute" dc:"HH:MM"`
	Total  int64   `json:"total"`
	Errors int64   `json:"errors"`
	AvgMs  float64 `json:"avgMs"`
	P95Ms  float64 `json:"p95Ms"`
}

type BufferStat struct {
	Capacity int   `json:"capacity"`
	Size     int   `json:"size"`
	Total    int64 `json:"total" dc:"进程内累计采集的日志条数"`
	Clients  int   `json:"clients" dc:"实时日志订阅连接数"`
}

type RuntimeStat struct {
	GoVersion   string  `json:"goVersion"`
	NumCPU      int     `json:"numCPU"`
	Goroutines  int     `json:"goroutines"`
	HeapAllocMB float64 `json:"heapAllocMB"`
	HeapInuseMB float64 `json:"heapInuseMB"`
	SysMB       float64 `json:"sysMB"`
	NumGC       uint32  `json:"numGC"`
	StartedAt   string  `json:"startedAt"`
	UptimeSec   int64   `json:"uptimeSec"`
}

type LogsReq struct {
	g.Meta  `path:"/observability/logs" method:"get" tags:"Observability" summary:"运行日志查询"`
	Level   string `json:"level"   in:"query" dc:"debug | info | warn | error，空表示全部"`
	Source  string `json:"source"  in:"query" dc:"server | access | agent | deploy | config | auth"`
	Service string `json:"service" in:"query" dc:"服务名，空表示全部服务"`
	Keyword string `json:"keyword" in:"query" dc:"关键字，匹配消息 / 路径 / 用户 / 节点"`
	Limit   int    `json:"limit"   in:"query" d:"200" dc:"返回条数，默认 200，最大 1000"`
	AfterId int64  `json:"afterId" in:"query" dc:"增量拉取：只返回 id 大于该值的日志"`
}

type LogsRes struct {
	Items    []LogItem     `json:"items"`
	LastId   int64         `json:"lastId" dc:"本次返回的最后一条日志 id"`
	Sources  []string      `json:"sources" dc:"可用的日志来源"`
	Services []ServiceItem `json:"services" dc:"已接入日志的服务"`
}

type ServiceItem struct {
	Name   string `json:"name"`
	Count  int64  `json:"count" dc:"本次进程启动以来上报的日志条数"`
	LastTs int64  `json:"lastTs" dc:"最后一条日志时间"`
	SeenAt int64  `json:"seenAt" dc:"最后一次心跳或上报时间"`
}

type ServicesReq struct {
	g.Meta `path:"/observability/services" method:"get" tags:"Observability" summary:"已接入日志的微服务列表"`
}

type ServicesRes struct {
	Items []ServiceItem `json:"items"`
}

type IngestEntry struct {
	Ts         int64   `json:"ts"`
	Level      string  `json:"level"`
	Source     string  `json:"source"`
	Message    string  `json:"message"`
	Method     string  `json:"method"`
	Path       string  `json:"path"`
	Status     int     `json:"status"`
	DurationMs float64 `json:"durationMs"`
	IP         string  `json:"ip"`
}

type IngestReq struct {
	g.Meta    `path:"/observability/ingest" method:"post" tags:"Observability" summary:"微服务日志上报（内部接口）"`
	Service   string        `json:"service" v:"required#service 不能为空"`
	Heartbeat bool          `json:"heartbeat" dc:"仅上报存活心跳，entries 可为空"`
	Entries   []IngestEntry `json:"entries"`
}

type IngestRes struct {
	Accepted int `json:"accepted" dc:"接收的日志条数"`
}

type LogItem struct {
	Id         int64   `json:"id"`
	Ts         int64   `json:"ts"`
	Time       string  `json:"time"`
	Level      string  `json:"level"`
	Source     string  `json:"source"`
	Service    string  `json:"service,omitempty"`
	Message    string  `json:"message"`
	Method     string  `json:"method,omitempty"`
	Path       string  `json:"path,omitempty"`
	Status     int     `json:"status,omitempty"`
	DurationMs float64 `json:"durationMs,omitempty"`
	User       string  `json:"user,omitempty"`
	IP         string  `json:"ip,omitempty"`
	NodeId     string  `json:"nodeId,omitempty"`
	JobId      int64   `json:"jobId,omitempty"`
	Action     string  `json:"action,omitempty"`
}
