package config

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"configure-center/pkg/etcdcfg"
	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/os/gtime"

	v1 "configure-server/api/config/v1"
	"configure-server/internal/service"
	"configure-server/utility/etcdx"
)

const (
	actionCreate   = "CREATE"
	actionUpdate   = "UPDATE"
	actionDelete   = "DELETE"
	actionRollback = "ROLLBACK"
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
	action := actionCreate
	if _, err := etcdx.Client().GetShared(ctx, key); err == nil {
		action = actionUpdate
	}
	if err := etcdx.Client().PutShared(ctx, key, content); err != nil {
		return err
	}
	s.recordHistory(ctx, fullKey("shared", key), content, action, audit)
	return nil
}

func (s *sConfig) DeleteShared(ctx context.Context, key string, audit service.Audit) error {
	prev := ""
	if item, err := etcdx.Client().GetShared(ctx, key); err == nil {
		prev = item.Content
	}
	if err := etcdx.Client().DeleteShared(ctx, key); err != nil {
		return err
	}
	s.recordHistory(ctx, fullKey("shared", key), prev, actionDelete, audit)
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
	action := actionCreate
	if _, err := etcdx.Client().GetService(ctx, name); err == nil {
		action = actionUpdate
	}
	if err := etcdx.Client().PutService(ctx, name, content); err != nil {
		return err
	}
	s.recordHistory(ctx, fullKey("services", name), content, action, audit)
	return nil
}

func (s *sConfig) DeleteService(ctx context.Context, name string, audit service.Audit) error {
	prev := ""
	if item, err := etcdx.Client().GetService(ctx, name); err == nil {
		prev = item.Content
	}
	if err := etcdx.Client().DeleteService(ctx, name); err != nil {
		return err
	}
	s.recordHistory(ctx, fullKey("services", name), prev, actionDelete, audit)
	return nil
}

func (s *sConfig) Preview(ctx context.Context, name string) (string, error) {
	return etcdx.Client().LoadMergedYAML(ctx, name)
}

func (s *sConfig) Seed(ctx context.Context, dir string, force bool, audit service.Audit) (int, error) {
	if dir == "" {
		dir = "manifest/etcd-seed"
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
			if err = client.Put(ctx, fk, content); err != nil {
				return written, err
			}
			s.recordHistory(ctx, fk, content, actionUpdate, audit)
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
	if err = etcdx.Client().Put(ctx, fk, row.Content); err != nil {
		return 0, err
	}
	if audit.Remark == "" {
		audit.Remark = "回滚至版本 " + g.NewVar(version).String()
	}
	return s.recordHistory(ctx, fk, row.Content, actionRollback, audit)
}

func (s *sConfig) recordHistory(ctx context.Context, configKey, content, action string, audit service.Audit) (int, error) {
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
	if audit.Operator == "" {
		audit.Operator = "anonymous"
	}
	_, err = g.DB().Model("config_history").Data(g.Map{
		"config_key":  configKey,
		"version":     next,
		"content":     content,
		"action_type": action,
		"operator":    audit.Operator,
		"remark":      audit.Remark,
	}).Insert()
	if err != nil {
		g.Log().Warningf(ctx, "写入审计日志失败（etcd 已写入）: %v", err)
		return 0, err
	}
	return next, nil
}
