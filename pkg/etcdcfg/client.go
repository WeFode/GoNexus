package etcdcfg

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/gogf/gf/v2/encoding/gjson"
	"github.com/gogf/gf/v2/errors/gerror"
	clientv3 "go.etcd.io/etcd/client/v3"
)

type Options struct {
	// Host 见 ParseHost：ip:port@serviceName
	Host string
	// Username / Password 可选，etcd 开启认证时填写。
	Username string
	Password string
	// Prefix 默认 /config-center
	Prefix string
	// Watch 为 true 时监听 etcd 并热更新内存快照，不重启进程、不重连数据库。
	Watch bool
	// SkipSharedWatch 为 true 时不消费 /shared/* 变更（默认会监听公共配置）。
	SkipSharedWatch bool
	// StickyKeys 不参与热重载的根 key（如 database、redis、server）。
	// 未配置或为空时，所有配置项（含 database）均默认 live 热重载。
	// 热重载只替换内存快照，不重启进程、不重建已有长连接。
	StickyKeys []string
	// SnapshotDir 合并后 YAML 的本地容灾目录，默认 data/config-cache。
	// 文件名固定为 <service>.snapshot.yaml。etcd 不可用且文件存在时用其启动。
	SnapshotDir string
	// LoopbackAs 将合并配置里的 127.0.0.1 替换为此主机名。
	// Docker 容器访问宿主机上的 etcd/Postgres/Redis 时填 host.docker.internal。
	LoopbackAs string
	// DialTimeout 默认 5s
	DialTimeout time.Duration
}

type Item struct {
	Key      string `json:"key"`
	FullKey  string `json:"fullKey"`
	Content  string `json:"content"`
	Revision int64  `json:"revision"`
}

type Client struct {
	cli      *clientv3.Client
	prefix   string
	parsed   ParsedHost
	username string
	password string
}

func NewClient(ctx context.Context, opts Options) (*Client, error) {
	parsed, err := ParseHost(opts.Host)
	if err != nil {
		return nil, err
	}
	timeout := opts.DialTimeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	cli, err := clientv3.New(clientv3.Config{
		Endpoints:   parsed.Endpoints,
		DialTimeout: timeout,
		Username:    opts.Username,
		Password:    opts.Password,
	})
	if err != nil {
		return nil, gerror.Wrapf(err, "连接 etcd 失败: %s", strings.Join(parsed.Endpoints, ","))
	}

	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err = ping(pingCtx, cli, parsed.Endpoints[0]); err != nil {
		_ = cli.Close()
		return nil, err
	}

	return &Client{
		cli:      cli,
		prefix:   normalizePrefix(opts.Prefix),
		parsed:   parsed,
		username: opts.Username,
		password: opts.Password,
	}, nil
}

func ping(ctx context.Context, cli *clientv3.Client, endpoint string) error {
	if _, err := cli.Status(ctx, endpoint); err != nil {
		return gerror.Wrapf(err, "etcd 健康检查失败: %s", endpoint)
	}
	return nil
}

func (c *Client) Close() error {
	if c == nil || c.cli == nil {
		return nil
	}
	return c.cli.Close()
}

func (c *Client) Raw() *clientv3.Client { return c.cli }

func (c *Client) Prefix() string { return c.prefix }

func (c *Client) ServiceName() string { return c.parsed.ServiceName }

func (c *Client) Endpoints() []string { return append([]string{}, c.parsed.Endpoints...) }

func (c *Client) Ping(ctx context.Context) error {
	return ping(ctx, c.cli, c.parsed.Endpoints[0])
}

func (c *Client) Get(ctx context.Context, fullKey string) (*Item, error) {
	resp, err := c.cli.Get(ctx, fullKey)
	if err != nil {
		return nil, gerror.Wrapf(err, "读取 etcd 失败: %s", fullKey)
	}
	if len(resp.Kvs) == 0 {
		return nil, gerror.Newf("配置不存在: %s", fullKey)
	}
	kv := resp.Kvs[0]
	return &Item{
		Key:      fullKey,
		FullKey:  fullKey,
		Content:  string(kv.Value),
		Revision: kv.ModRevision,
	}, nil
}

func (c *Client) Put(ctx context.Context, fullKey, content string) error {
	if strings.TrimSpace(fullKey) == "" {
		return gerror.New("etcd key 不能为空")
	}
	if _, err := yamlToMap(content); err != nil {
		return err
	}
	if _, err := c.cli.Put(ctx, fullKey, content); err != nil {
		return gerror.Wrapf(err, "写入 etcd 失败: %s", fullKey)
	}
	return nil
}

func (c *Client) Delete(ctx context.Context, fullKey string) error {
	resp, err := c.cli.Delete(ctx, fullKey)
	if err != nil {
		return gerror.Wrapf(err, "删除 etcd 失败: %s", fullKey)
	}
	if resp.Deleted == 0 {
		return gerror.Newf("配置不存在: %s", fullKey)
	}
	return nil
}

func (c *Client) ListPrefix(ctx context.Context, keyPrefix string) ([]Item, error) {
	resp, err := c.cli.Get(ctx, keyPrefix, clientv3.WithPrefix())
	if err != nil {
		return nil, gerror.Wrapf(err, "列举 etcd 失败: %s", keyPrefix)
	}
	items := make([]Item, 0, len(resp.Kvs))
	for _, kv := range resp.Kvs {
		full := string(kv.Key)
		items = append(items, Item{
			Key:      nameFromKey(keyPrefix, full),
			FullKey:  full,
			Content:  string(kv.Value),
			Revision: kv.ModRevision,
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	return items, nil
}

func (c *Client) ListShared(ctx context.Context) ([]Item, error) {
	return c.ListPrefix(ctx, SharedPrefix(c.prefix))
}

func (c *Client) ListServices(ctx context.Context) ([]Item, error) {
	return c.ListPrefix(ctx, ServicePrefix(c.prefix))
}

func (c *Client) GetShared(ctx context.Context, name string) (*Item, error) {
	item, err := c.Get(ctx, SharedKey(c.prefix, name))
	if err != nil {
		return nil, err
	}
	item.Key = name
	return item, nil
}

func (c *Client) GetService(ctx context.Context, name string) (*Item, error) {
	item, err := c.Get(ctx, ServiceKey(c.prefix, name))
	if err != nil {
		return nil, err
	}
	item.Key = name
	return item, nil
}

func (c *Client) PutShared(ctx context.Context, name, content string) error {
	return c.Put(ctx, SharedKey(c.prefix, name), content)
}

func (c *Client) PutService(ctx context.Context, name, content string) error {
	return c.Put(ctx, ServiceKey(c.prefix, name), content)
}

func (c *Client) DeleteShared(ctx context.Context, name string) error {
	return c.Delete(ctx, SharedKey(c.prefix, name))
}

func (c *Client) DeleteService(ctx context.Context, name string) error {
	return c.Delete(ctx, ServiceKey(c.prefix, name))
}

func (c *Client) PutIfAbsent(ctx context.Context, fullKey, content string) (bool, error) {
	if _, err := yamlToMap(content); err != nil {
		return false, err
	}
	resp, err := c.cli.Txn(ctx).
		If(clientv3.Compare(clientv3.CreateRevision(fullKey), "=", 0)).
		Then(clientv3.OpPut(fullKey, content)).
		Commit()
	if err != nil {
		return false, gerror.Wrapf(err, "写入 etcd 失败: %s", fullKey)
	}
	return resp.Succeeded, nil
}

// LoadMerged 将全部 shared 配置与指定服务配置做深层合并。服务配置覆盖公共配置。
func (c *Client) LoadMerged(ctx context.Context, serviceName string) (*gjson.Json, error) {
	if strings.TrimSpace(serviceName) == "" {
		return nil, gerror.New("服务名不能为空")
	}

	merged := make(map[string]any)
	shared, err := c.ListShared(ctx)
	if err != nil {
		return nil, err
	}
	for _, item := range shared {
		m, err := yamlToMap(item.Content)
		if err != nil {
			return nil, gerror.Wrapf(err, "公共配置 %s", item.Key)
		}
		merged = deepMerge(merged, m)
	}

	svc, err := c.GetService(ctx, serviceName)
	if err != nil {
		return nil, err
	}
	svcMap, err := yamlToMap(svc.Content)
	if err != nil {
		return nil, gerror.Wrapf(err, "服务配置 %s", serviceName)
	}
	merged = deepMerge(merged, svcMap)
	return gjson.New(merged), nil
}

func (c *Client) LoadMergedYAML(ctx context.Context, serviceName string) (string, error) {
	j, err := c.LoadMerged(ctx, serviceName)
	if err != nil {
		return "", err
	}
	return mapToYAML(j.Map())
}
