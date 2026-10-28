package config

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"configure-center/pkg/etcdcfg"
	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"

	v1 "configure-server/api/config/v1"
	obsv "configure-server/internal/observability"
	"configure-server/internal/service"
	"configure-server/utility/etcdx"
)

const (
	actionCreate   = "CREATE"
	actionUpdate   = "UPDATE"
	actionDelete   = "DELETE"
	actionRollback = "ROLLBACK"
	actionBaseline = "BASELINE"
)

type sConfig struct{}

func init() {
	service.RegisterConfig(New())
}

func New() *sConfig {
	return &sConfig{}
}

func toItem(item etcdcfg.Item) v1.ConfigItem {
	return v1.ConfigItem{
		Key:      item.Key,
		FullKey:  item.FullKey,
		Content:  item.Content,
		Revision: item.Revision,
	}
}

func toItems(items []etcdcfg.Item) []v1.ConfigItem {
	out := make([]v1.ConfigItem, 0, len(items))
	for _, item := range items {
		out = append(out, toItem(item))
	}
	return out
}

func fullKey(kind, name string) string {
	p := etcdx.Client().Prefix()
	if kind == "services" {
		return etcdcfg.ServiceKey(p, name)
	}
	return etcdcfg.SharedKey(p, name)
}

func (s *sConfig) ListShared(ctx context.Context) ([]v1.ConfigItem, error) {
	items, err := etcdx.Client().ListShared(ctx)
	if err != nil {
		return nil, err
	}
	return toItems(items), nil
}

func (s *sConfig) GetShared(ctx context.Context, key string) (*v1.ConfigItem, error) {
	item, err := etcdx.Client().GetShared(ctx, key)
	if err != nil {
		return nil, err
	}
	res := toItem(*item)
	return &res, nil
}

func (s *sConfig) PutShared(ctx context.Context, key, content string, audit service.Audit) error {
	return s.putConfig(ctx, "shared", key, content, audit)
}

func (s *sConfig) DeleteShared(ctx context.Context, key string, audit service.Audit) error {
	prev := ""
	if item, err := etcdx.Client().GetShared(ctx, key); err == nil {
		prev = item.Content
	}
	if err := etcdx.Client().DeleteShared(ctx, key); err != nil {
		return err
	}
	fk := fullKey("shared", key)
	ver, _ := s.recordHistory(ctx, fk, prev, actionDelete, audit)
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceConfig, Action: "delete", User: audit.Operator,
		Message: configChangedText("删除配置", fk, ver),
	})
	return nil
}

func (s *sConfig) ListServices(ctx context.Context) ([]v1.ConfigItem, error) {
	items, err := etcdx.Client().ListServices(ctx)
	if err != nil {
		return nil, err
	}
	return toItems(items), nil
}

func (s *sConfig) GetService(ctx context.Context, name string) (*v1.ConfigItem, error) {
	item, err := etcdx.Client().GetService(ctx, name)
	if err != nil {
		return nil, err
	}
	res := toItem(*item)
	return &res, nil
}

func (s *sConfig) PutService(ctx context.Context, name, content string, audit service.Audit) error {
	return s.putConfig(ctx, "services", name, content, audit)
}

func (s *sConfig) putConfig(ctx context.Context, kind, name, content string, audit service.Audit) error {
	client := etcdx.Client()
	prev := ""
	exists := false
	if kind == "services" {
		if item, err := client.GetService(ctx, name); err == nil {
			exists, prev = true, item.Content
		}
	} else if item, err := client.GetShared(ctx, name); err == nil {
		exists, prev = true, item.Content
	}
	if exists && prev == content {
		return nil
	}
	var err error
	if kind == "services" {
		err = client.PutService(ctx, name, content)
	} else {
		err = client.PutShared(ctx, name, content)
	}
	if err != nil {
		return err
	}
	fk := fullKey(kind, name)
	if !exists {
		ver, _ := s.recordHistory(ctx, fk, content, actionCreate, audit)
		obsv.Emit(obsv.Entry{
			Source: obsv.SourceConfig, Action: "create", User: audit.Operator,
			Message: configChangedText("新增配置", fk, ver),
		})
		return nil
	}
	s.ensureBaseline(ctx, fk, prev, audit)
	ver, _ := s.recordHistory(ctx, fk, content, actionUpdate, audit)
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceConfig, Action: "update", User: audit.Operator,
		Message: configChangedText("更新配置", fk, ver),
	})
	return nil
}

func configChangedText(prefix, key string, version int) string {
	if version > 0 {
		return fmt.Sprintf("%s %s（v%d）", prefix, key, version)
	}
	return fmt.Sprintf("%s %s", prefix, key)
}

func (s *sConfig) DeleteService(ctx context.Context, name string, audit service.Audit) error {
	prev := ""
	if item, err := etcdx.Client().GetService(ctx, name); err == nil {
		prev = item.Content
	}
	if err := etcdx.Client().DeleteService(ctx, name); err != nil {
		return err
	}
	fk := fullKey("services", name)
	ver, _ := s.recordHistory(ctx, fk, prev, actionDelete, audit)
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceConfig, Action: "delete", User: audit.Operator,
		Message: configChangedText("删除配置", fk, ver),
	})
	return nil
}

func (s *sConfig) Preview(ctx context.Context, name string) (string, error) {
	return etcdx.Client().LoadMergedYAML(ctx, name)
}

// seedRootDir 是 Seed 允许读取的根目录。API 的 dir 参数不能越过它，
// 否则已登录用户可以借服务端读任意目录下的 yaml。
func seedRootDir() string {
	dir := strings.TrimSpace(g.Cfg().MustGet(context.Background(), "svc.etcd.seedDir").String())
	if dir == "" {
		dir = "manifest/etcd-seed"
	}
	return dir
}

func withinDir(root, dir string) bool {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absDir, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absDir)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func (s *sConfig) Seed(ctx context.Context, dir string, force bool, audit service.Audit) (int, error) {
	root := seedRootDir()
	if dir == "" {
		dir = root
	}
	if !withinDir(root, dir) {
		return 0, gerror.Newf("seed 目录必须位于 %s 之内", root)
	}
	info, err := os.Stat(dir)
	if err != nil {
		return 0, gerror.Wrapf(err, "seed 目录不存在: %s", dir)
	}
	if !info.IsDir() {
		return 0, gerror.Newf("seed 路径不是目录: %s", dir)
	}

	written := 0
	n, err := s.seedGroup(ctx, filepath.Join(dir, "shared"), "shared", force, audit)
	if err != nil {
		return written, err
	}
	written += n
	n, err = s.seedGroup(ctx, filepath.Join(dir, "services"), "services", force, audit)
	if err != nil {
		return written, err
	}
	written += n
	return written, nil
}

func (s *sConfig) seedGroup(ctx context.Context, dir, kind string, force bool, audit service.Audit) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	written := 0
	client := etcdx.Client()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := strings.ToLower(filepath.Ext(name))
		if ext != ".yaml" && ext != ".yml" {
			continue
		}
		key := strings.TrimSuffix(name, filepath.Ext(name))
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			return written, err
		}
		content := string(raw)
		fk := fullKey(kind, key)
		if force {
			prev := ""
			if item, gerr := client.Get(ctx, fk); gerr == nil {
				prev = item.Content
			}
			if err = client.Put(ctx, fk, content); err != nil {
				return written, err
			}
			if prev == "" {
				s.recordHistory(ctx, fk, content, actionCreate, audit)
			} else if prev != content {
				s.ensureBaseline(ctx, fk, prev, audit)
				s.recordHistory(ctx, fk, content, actionUpdate, audit)
			}
			written++
			continue
		}
		ok, err := client.PutIfAbsent(ctx, fk, content)
		if err != nil {
			return written, err
		}
		if ok {
			s.recordHistory(ctx, fk, content, actionCreate, audit)
			written++
		}
	}
	return written, nil
}

type historyRow struct {
	Id         int64       `json:"id"`
	ConfigKey  string      `json:"configKey" orm:"config_key"`
	Version    int         `json:"version"`
	Content    string      `json:"content"`
	ActionType string      `json:"actionType" orm:"action_type"`
	Operator   string      `json:"operator"`
	Remark     string      `json:"remark"`
	CreatedAt  *gtime.Time `json:"createdAt" orm:"created_at"`
}

func (s *sConfig) ListHistory(ctx context.Context, kind, key string) ([]v1.HistoryItem, error) {
	fk := fullKey(kind, key)
	var rows []historyRow
	err := g.DB().Model("config_history").
		Where("config_key", fk).
		OrderDesc("version").
		Limit(100).
		Scan(&rows)
	if err != nil {
		return nil, err
	}
	list := make([]v1.HistoryItem, 0, len(rows))
	for _, row := range rows {
		item := v1.HistoryItem{
			Id:         row.Id,
			ConfigKey:  row.ConfigKey,
			Version:    row.Version,
			Content:    row.Content,
			ActionType: row.ActionType,
			Operator:   row.Operator,
			Remark:     row.Remark,
		}
		if row.CreatedAt != nil {
			item.CreatedAt = row.CreatedAt.String()
		}
		list = append(list, item)
	}
	return list, nil
}

func shouldWriteBaseline(latestContent string, hasLatest bool, prev string) bool {
	if strings.TrimSpace(prev) == "" {
		return false
	}
	if hasLatest && latestContent == prev {
		return false
	}
	return true
}

func (s *sConfig) latestHistory(ctx context.Context, configKey string) (*historyRow, error) {
	var row historyRow
	err := g.DB().Model("config_history").
		Where("config_key", configKey).
		OrderDesc("version").
		Limit(1).
		Scan(&row)
	if err != nil {
		return nil, err
	}
	if row.Id == 0 {
		return nil, nil
	}
	return &row, nil
}

func (s *sConfig) ensureBaseline(ctx context.Context, configKey, prev string, audit service.Audit) {
	latest, err := s.latestHistory(ctx, configKey)
	if err != nil {
		g.Log().Warningf(ctx, "读取历史最新版本失败，仍尝试补录旧快照: %v", err)
	}
	hasLatest := latest != nil
	latestContent := ""
	if hasLatest {
		latestContent = latest.Content
	}
	if !shouldWriteBaseline(latestContent, hasLatest, prev) {
		return
	}
	s.recordHistory(ctx, configKey, prev, actionBaseline, service.Audit{
		Operator: audit.Operator,
		Remark:   "变更前快照",
	})
}

func (s *sConfig) Rollback(ctx context.Context, kind, key string, version int, audit service.Audit) (int, error) {
	fk := fullKey(kind, key)
	var row historyRow
	err := g.DB().Model("config_history").
		Where("config_key", fk).
		Where("version", version).
		Scan(&row)
	if err != nil {
		return 0, err
	}
	if row.Id == 0 {
		return 0, gerror.Newf("历史版本不存在: %s v%d", fk, version)
	}
	if cur, gerr := etcdx.Client().Get(ctx, fk); gerr == nil && cur.Content == row.Content {
		return 0, gerror.New("该版本已是当前配置，请选择更早的历史版本")
	}
	if err = etcdx.Client().Put(ctx, fk, row.Content); err != nil {
		return 0, err
	}
	if audit.Remark == "" {
		audit.Remark = "回滚至版本 " + g.NewVar(version).String()
	}
	ver, err := s.recordHistory(ctx, fk, row.Content, actionRollback, audit)
	if err != nil {
		return ver, err
	}
	obsv.Emit(obsv.Entry{
		Source: obsv.SourceConfig, Action: "rollback", User: audit.Operator,
		Message: fmt.Sprintf("回滚配置 %s 至版本 %d（新版本 v%d）", fk, version, ver),
	})
	return ver, nil
}

func (s *sConfig) recordHistory(ctx context.Context, configKey, content, action string, audit service.Audit) (int, error) {
	if audit.Operator == "" {
		audit.Operator = "anonymous"
	}
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		var maxVer int
		val, err := g.DB().Model("config_history").Where("config_key", configKey).Value("MAX(version)")
		if err != nil {
			g.Log().Warningf(ctx, "读取历史版本号失败（etcd 已写入）: %v", err)
			return 0, err
		}
		if val != nil && !val.IsEmpty() {
			maxVer = val.Int()
		}
		next := maxVer + 1
		_, err = g.DB().Model("config_history").Data(g.Map{
			"config_key":  configKey,
			"version":     next,
			"content":     content,
			"action_type": action,
			"operator":    audit.Operator,
			"remark":      audit.Remark,
		}).Insert()
		if err == nil {
			return next, nil
		}
		lastErr = err
		// 并发写同一 key 时 (config_key, version) 唯一索引会冲突，重新取 MAX 再试。
		if attempt < maxAttempts-1 {
			time.Sleep(time.Duration(10+attempt*20) * time.Millisecond)
		}
	}
	g.Log().Warningf(ctx, "写入审计日志失败（etcd 已写入，已重试 %d 次）: %v", maxAttempts, lastErr)
	return 0, lastErr
}
