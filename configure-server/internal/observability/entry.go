package observability

const (
	LevelDebug = "debug"
	LevelInfo  = "info"
	LevelWarn  = "warn"
	LevelError = "error"
)

const (
	SourceServer = "server"
	SourceAccess = "access"
	SourceAgent  = "agent"
	SourceDeploy = "deploy"
	SourceConfig = "config"
	SourceAuth   = "auth"
)

const (
	entryTimeLayout = "2006-01-02T15:04:05.000Z07:00"
	maxMessageRunes = 2000

	// LocalService 是本进程日志默认归属的服务名。
	LocalService = "configure-server"
)

// Entry 是一条可观测事件：既包含运行日志，也包含访问日志与业务埋点。
type Entry struct {
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

var sources = []string{SourceServer, SourceAccess, SourceAgent, SourceDeploy, SourceConfig, SourceAuth}

func Sources() []string {
	return append([]string(nil), sources...)
}

func NormalizeSource(source string) string {
	for _, s := range sources {
		if s == source {
			return source
		}
	}
	return SourceServer
}

func NormalizeLevel(level string) string {
	switch level {
	case LevelDebug, LevelInfo, LevelWarn, LevelError:
		return level
	default:
		return LevelInfo
	}
}

func truncateText(s string) string {
	runes := []rune(s)
	if len(runes) <= maxMessageRunes {
		return s
	}
	return string(runes[:maxMessageRunes]) + "…"
}
