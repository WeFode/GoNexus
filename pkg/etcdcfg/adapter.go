package etcdcfg

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/gogf/gf/v2/container/gvar"
	"github.com/gogf/gf/v2/encoding/gjson"
	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gcfg"
	clientv3 "go.etcd.io/etcd/client/v3"
)

const (
	SourceEtcd     = "etcd"
	SourceSnapshot = "snapshot"
)

var _ gcfg.Adapter = (*Adapter)(nil)

type snapshot struct {
	json       *gjson.Json
	reloadedAt time.Time
	changed    []string
	eventKeys  []string
}

// RuntimeInfo 供业务探测当前热更新状态，不触发重载。
type RuntimeInfo struct {
	Watch        bool      `json:"watch"`
	WatchShared  bool      `json:"watchShared"`
	StickyKeys   []string  `json:"stickyKeys"`
	Source       string    `json:"source" dc:"etcd | snapshot"`
	SnapshotPath string    `json:"snapshotPath"`
	ReloadedAt   time.Time `json:"reloadedAt"`
	Changed      []string  `json:"changed"`
	EventKeys    []string  `json:"eventKeys"`
}

// Adapter 实现 gcfg.Adapter：从 etcd 拉取 shared + 当前服务配置并合并。
// watch 只替换内存快照，不重启 HTTP、不重建 DB/Redis 连接。
type Adapter struct {
	mu           sync.Mutex
	opts         Options
	client       *Client
	service      string
	value        *gvar.Var
	watch        bool
	watchShared  bool
	stickyKeys   []string
	source       string
	snapshotPath string
	watchCancel  context.CancelFunc
	reloadMu     sync.Mutex
}

func NewAdapter(ctx context.Context, opts Options) (*Adapter, error) {
	parsed, err := ParseHost(opts.Host)
	if err != nil {
		return nil, err
	}
	if parsed.ServiceName == "" {
		return nil, gerror.New("微服务的 svc.etcd.host 必须为 ip:port@服务名")
	}
	a := &Adapter{
		opts:         opts,
		service:      parsed.ServiceName,
		value:        gvar.New(nil, true),
		watch:        opts.Watch,
		watchShared:  !opts.SkipSharedWatch,
		stickyKeys:   append([]string{}, opts.StickyKeys...),
		snapshotPath: snapshotFile(opts.SnapshotDir, parsed.ServiceName),
	}

	client, err := NewClient(ctx, opts)
	if err != nil {
		if loadErr := a.loadFromSnapshot(); loadErr != nil {
			return nil, gerror.Wrapf(err, "etcd 不可用且无本地快照(%v)", loadErr)
		}
		g.Log().Warningf(ctx, "etcd 不可用，已用本地快照启动: %s err=%v", a.snapshotPath, err)
		if a.watch {
			a.startReconnect()
		}
		return a, nil
	}
	a.client = client
	if err = a.reload(ctx); err != nil {
		_ = client.Close()
		a.client = nil
		if loadErr := a.loadFromSnapshot(); loadErr != nil {
			return nil, gerror.Wrapf(err, "拉取 etcd 配置失败且无本地快照(%v)", loadErr)
		}
		g.Log().Warningf(ctx, "拉取 etcd 配置失败，已用本地快照启动: %s err=%v", a.snapshotPath, err)
		if a.watch {
			a.startReconnect()
		}
		return a, nil
	}
	a.source = SourceEtcd
	if a.watch {
		a.startWatch()
	}
	return a, nil
}

func (a *Adapter) Client() *Client {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.client
}

func (a *Adapter) ServiceName() string { return a.service }

func (a *Adapter) Ping(ctx context.Context) error {
	c := a.Client()
	if c == nil {
		return gerror.New("etcd 未连接，当前使用本地快照")
	}
	return c.Ping(ctx)
}

func (a *Adapter) Close() error {
	if a.watchCancel != nil {
		a.watchCancel()
	}
	c := a.Client()
	if c == nil {
		return nil
	}
	return c.Close()
}

func (a *Adapter) RuntimeInfo() RuntimeInfo {
	a.mu.Lock()
	source := a.source
	path := a.snapshotPath
	a.mu.Unlock()
	info := RuntimeInfo{
		Watch:        a.watch,
		WatchShared:  a.watchShared,
		StickyKeys:   append([]string{}, a.stickyKeys...),
		Source:       source,
		SnapshotPath: path,
	}
	if snap, ok := a.snapshot(); ok {
		info.ReloadedAt = snap.reloadedAt
		info.Changed = append([]string{}, snap.changed...)
		info.EventKeys = append([]string{}, snap.eventKeys...)
	}
	return info
}

func (a *Adapter) Available(_ context.Context, _ ...string) bool {
	return a.value != nil && !a.value.IsNil()
}

func (a *Adapter) Get(ctx context.Context, pattern string) (value any, err error) {
	if !a.watch && !matchRoots(pattern, a.stickyKeys) {
		if c := a.Client(); c != nil {
			j, err := c.LoadMerged(ctx, a.service)
			if err != nil {
				return nil, err
			}
			return j.Get(pattern).Val(), nil
		}
	}
	j, err := a.json()
	if err != nil {
		return nil, err
	}
	return j.Get(pattern).Val(), nil
}

func (a *Adapter) Data(ctx context.Context) (data map[string]any, err error) {
	if !a.watch {
		if c := a.Client(); c != nil {
			j, err := c.LoadMerged(ctx, a.service)
			if err != nil {
				return nil, err
			}
			return j.Map(), nil
		}
	}
	j, err := a.json()
	if err != nil {
		return nil, err
	}
	return j.Map(), nil
}

func (a *Adapter) snapshot() (*snapshot, bool) {
	if a.value == nil || a.value.IsNil() {
		return nil, false
	}
	s, ok := a.value.Val().(*snapshot)
	return s, ok && s != nil && s.json != nil
}

func (a *Adapter) json() (*gjson.Json, error) {
	s, ok := a.snapshot()
	if !ok {
		return nil, gerror.New("etcd 配置尚未加载")
	}
	return s.json, nil
}

func (a *Adapter) currentMap() map[string]any {
	s, ok := a.snapshot()
	if !ok {
		return map[string]any{}
	}
	m := s.json.Map()
	if m == nil {
		return map[string]any{}
	}
	return m
}

func (a *Adapter) loadFromSnapshot() error {
	raw, err := readSnapshotFile(a.snapshotPath)
	if err != nil {
		return err
	}
	m, err := yamlToMap(raw)
	if err != nil {
		return err
	}
	m = applyLoopback(m, a.opts.LoopbackAs)
	a.value.Set(&snapshot{
		json:       gjson.New(m),
		reloadedAt: time.Now(),
	})
	a.mu.Lock()
	a.source = SourceSnapshot
	a.mu.Unlock()
	return nil
}

func (a *Adapter) persistMerged(merged map[string]any) {
	yaml, err := mapToYAML(merged)
	if err != nil {
		g.Log().Warningf(context.Background(), "编码快照失败: %v", err)
		return
	}
	if err = atomicWriteFile(a.snapshotPath, yaml); err != nil {
		g.Log().Warningf(context.Background(), "写入本地快照失败: %s %v", a.snapshotPath, err)
	}
}

func (a *Adapter) reload(ctx context.Context, eventKeys ...string) error {
	c := a.Client()
	if c == nil {
		return gerror.New("etcd 未连接")
	}
	if shouldSkipReload(eventKeys, a.stickyKeys, c.Prefix(), a.service) {
		g.Log().Debugf(ctx, "etcd 配置跳过拉取: 仅 sticky shared 变更 events=%v sticky=%v", eventKeys, a.stickyKeys)
		return nil
	}

	a.reloadMu.Lock()
	defer a.reloadMu.Unlock()

	j, err := c.LoadMerged(ctx, a.service)
	if err != nil {
		return err
	}
	newMap := applyLoopback(j.Map(), a.opts.LoopbackAs)
	a.persistMerged(newMap)

	oldMap := a.currentMap()
	finalMap := applySticky(oldMap, newMap, a.stickyKeys)
	changed := changedKeys(oldMap, finalMap)
	liveChanged, stickyChanged := splitChanged(changed, a.stickyKeys)

	a.value.Set(&snapshot{
		json:       gjson.New(finalMap),
		reloadedAt: time.Now(),
		changed:    changed,
		eventKeys:  append([]string{}, eventKeys...),
	})
	a.mu.Lock()
	a.source = SourceEtcd
	a.mu.Unlock()

	if len(eventKeys) == 0 {
		return nil
	}
	if len(liveChanged) > 0 {
		g.Log().Infof(ctx, "etcd 配置热更新: service=%s live=%v events=%v", a.service, liveChanged, eventKeys)
	}
	if len(stickyChanged) > 0 {
		g.Log().Debugf(ctx, "sticky 配置已忽略热更新: %v", stickyChanged)
	}
	if len(liveChanged) == 0 && len(stickyChanged) == 0 && len(eventKeys) > 0 {
		g.Log().Debugf(ctx, "etcd 配置热更新: service=%s events=%v（内容无变化）", a.service, eventKeys)
	}
	return nil
}

func (a *Adapter) relevantKey(fullKey string) bool {
	c := a.Client()
	if c == nil {
		return false
	}
	p := c.Prefix()
	if strings.HasPrefix(fullKey, SharedPrefix(p)) {
		return a.watchShared
	}
	return fullKey == ServiceKey(p, a.service)
}

func (a *Adapter) startWatch() {
	if a.watchCancel != nil {
		a.watchCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.watchCancel = cancel
	notify := make(chan string, 64)
	go a.debounceLoop(ctx, notify)
	c := a.Client()
	if c == nil {
		return
	}
	if a.watchShared {
		go a.watchLoop(ctx, notify, SharedPrefix(c.Prefix()), true)
	}
	go a.watchLoop(ctx, notify, ServiceKey(c.Prefix(), a.service), false)
}

func (a *Adapter) watchLoop(ctx context.Context, notify chan<- string, key string, prefix bool) {
	for {
		c := a.Client()
		if c == nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(3 * time.Second):
				continue
			}
		}
		opts := []clientv3.OpOption{}
		if prefix {
			opts = append(opts, clientv3.WithPrefix())
		}
		watchCh := c.Raw().Watch(ctx, key, opts...)
		for wresp := range watchCh {
			if err := wresp.Err(); err != nil {
				g.Log().Warningf(ctx, "etcd watch 中断 %s: %v", key, err)
				break
			}
			for _, ev := range wresp.Events {
				if ev == nil || ev.Kv == nil {
					continue
				}
				k := string(ev.Kv.Key)
				if !a.relevantKey(k) {
					continue
				}
				select {
				case notify <- k:
				case <-ctx.Done():
					return
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}
	}
}

func (a *Adapter) debounceLoop(ctx context.Context, notify <-chan string) {
	var (
		timerC <-chan time.Time
		timer  *time.Timer
		batch  []string
	)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		keys := append([]string{}, batch...)
		batch = nil
		timerC = nil
		reloadCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := a.reload(reloadCtx, keys...); err != nil {
			g.Log().Warningf(reloadCtx, "etcd 配置热更新失败，保留上一份快照: %v", err)
		}
		cancel()
	}
	for {
		select {
		case <-ctx.Done():
			return
		case key := <-notify:
			batch = append(batch, key)
			if timer == nil {
				timer = time.NewTimer(150 * time.Millisecond)
			} else {
				timer.Reset(150 * time.Millisecond)
			}
			timerC = timer.C
		case <-timerC:
			flush()
		}
	}
}

func (a *Adapter) startReconnect() {
	go func() {
		ctx := context.Background()
		for {
			time.Sleep(5 * time.Second)
			if info := a.RuntimeInfo(); info.Source == SourceEtcd && a.Client() != nil {
				return
			}
			client, err := NewClient(ctx, a.opts)
			if err != nil {
				g.Log().Debugf(ctx, "etcd 重连失败: %v", err)
				continue
			}
			a.mu.Lock()
			old := a.client
			a.client = client
			a.mu.Unlock()
			if old != nil {
				_ = old.Close()
			}
			if err = a.reload(ctx); err != nil {
				g.Log().Warningf(ctx, "etcd 重连后拉取配置失败: %v", err)
				a.mu.Lock()
				a.client = nil
				a.mu.Unlock()
				_ = client.Close()
				continue
			}
			g.Log().Infof(ctx, "etcd 已恢复，切回远程配置 source=etcd")
			if a.watch {
				a.startWatch()
			}
			return
		}
	}()
}
