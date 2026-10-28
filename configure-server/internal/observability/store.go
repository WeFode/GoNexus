package observability

import (
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const defaultStoreCapacity = 2000

type Filter struct {
	Level   string
	Source  string
	Service string
	Keyword string
	Limit   int
	AfterId int64
}

type BufferStat struct {
	Capacity int   `json:"capacity"`
	Size     int   `json:"size"`
	Total    int64 `json:"total"`
	Clients  int   `json:"clients"`
}

type ServiceStat struct {
	Name   string `json:"name"`
	Count  int64  `json:"count"`
	LastTs int64  `json:"lastTs"`
	SeenAt int64  `json:"seenAt"`
}

type Store struct {
	mu       sync.RWMutex
	buf      []Entry
	head     int
	size     int
	subs     map[int64]chan Entry
	services map[string]*ServiceStat
	nextSub  int64
	nextId   atomic.Int64
	total    atomic.Int64
}

func NewStore(capacity int) *Store {
	if capacity <= 0 {
		capacity = defaultStoreCapacity
	}
	return &Store{
		buf:      make([]Entry, capacity),
		subs:     make(map[int64]chan Entry),
		services: make(map[string]*ServiceStat),
	}
}

func (s *Store) Add(e Entry) Entry {
	now := time.Now()
	e.Id = s.nextId.Add(1)
	if e.Ts <= 0 {
		e.Ts = now.UnixMilli()
	}
	if e.Time == "" {
		e.Time = time.UnixMilli(e.Ts).Format(entryTimeLayout)
	}
	if e.Level == "" {
		e.Level = LevelInfo
	}
	if e.Source == "" {
		e.Source = SourceServer
	}
	if e.Service == "" {
		e.Service = LocalService
	}
	e.Message = truncateText(e.Message)

	s.mu.Lock()
	s.buf[s.head] = e
	s.head = (s.head + 1) % len(s.buf)
	if s.size < len(s.buf) {
		s.size++
	}
	st := s.services[e.Service]
	if st == nil {
		st = &ServiceStat{Name: e.Service}
		s.services[e.Service] = st
	}
	st.Count++
	st.LastTs = e.Ts
	st.SeenAt = now.UnixMilli()
	// 在锁内广播，保证订阅者收到的 id 顺序一致。
	for _, ch := range s.subs {
		select {
		case ch <- e:
		default:
		}
	}
	s.mu.Unlock()

	s.total.Add(1)
	return e
}

// Query 返回满足条件的最新 limit 条事件（按时间升序）以及最后一条的 id。
func (s *Store) Query(f Filter) ([]Entry, int64) {
	if f.Limit <= 0 {
		f.Limit = 200
	}
	if f.Limit > 1000 {
		f.Limit = 1000
	}
	keyword := strings.ToLower(strings.TrimSpace(f.Keyword))

	s.mu.RLock()
	defer s.mu.RUnlock()

	out := make([]Entry, 0, f.Limit)
	for i := s.size - 1; i >= 0 && len(out) < f.Limit; i-- {
		e := s.buf[(s.head-s.size+i+len(s.buf))%len(s.buf)]
		if f.AfterId > 0 && e.Id <= f.AfterId {
			break
		}
		if f.Level != "" && e.Level != f.Level {
			continue
		}
		if f.Source != "" && e.Source != f.Source {
			continue
		}
		if f.Service != "" && e.Service != f.Service {
			continue
		}
		if keyword != "" && !matchKeyword(e, keyword) {
			continue
		}
		out = append(out, e)
	}
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	var lastId int64
	if n := len(out); n > 0 {
		lastId = out[n-1].Id
	}
	return out, lastId
}

func matchKeyword(e Entry, keyword string) bool {
	fields := []string{e.Message, e.Path, e.User, e.NodeId, e.Action, e.Method, e.Service}
	for _, f := range fields {
		if f != "" && strings.Contains(strings.ToLower(f), keyword) {
			return true
		}
	}
	return false
}

func (s *Store) Subscribe() (int64, <-chan Entry) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.nextSub++
	id := s.nextSub
	ch := make(chan Entry, 128)
	s.subs[id] = ch
	return id, ch
}

func (s *Store) Unsubscribe(id int64) {
	s.mu.Lock()
	delete(s.subs, id)
	s.mu.Unlock()
}

// TouchService 记录服务最近一次心跳或日志上报时间，用于日志终端判断服务在线状态。
func (s *Store) TouchService(name string) {
	name = strings.TrimSpace(name)
	if name == "" {
		return
	}
	now := time.Now().UnixMilli()
	s.mu.Lock()
	st := s.services[name]
	if st == nil {
		st = &ServiceStat{Name: name}
		s.services[name] = st
	}
	st.SeenAt = now
	s.mu.Unlock()
}

func (s *Store) ServiceStats() []ServiceStat {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]ServiceStat, 0, len(s.services))
	for _, st := range s.services {
		out = append(out, *st)
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Name == LocalService) != (out[j].Name == LocalService) {
			return out[i].Name == LocalService
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func (s *Store) Stat() BufferStat {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return BufferStat{
		Capacity: len(s.buf),
		Size:     s.size,
		Total:    s.total.Load(),
		Clients:  len(s.subs),
	}
}

var defaultStore = NewStore(defaultStoreCapacity)

func Emit(e Entry) Entry { return defaultStore.Add(e) }

func Query(f Filter) ([]Entry, int64) { return defaultStore.Query(f) }

func Subscribe() (int64, <-chan Entry) { return defaultStore.Subscribe() }

func Unsubscribe(id int64) { defaultStore.Unsubscribe(id) }

func BufferStatus() BufferStat { return defaultStore.Stat() }

func TouchService(name string) { defaultStore.TouchService(name) }

func ServiceStats() []ServiceStat { return defaultStore.ServiceStats() }
