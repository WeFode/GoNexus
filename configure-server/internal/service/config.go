package service

import (
	"context"

	v1 "configure-server/api/config/v1"
)

type Audit struct {
	Operator string
	Remark   string
}

type IConfig interface {
	ListShared(ctx context.Context) ([]v1.ConfigItem, error)
	GetShared(ctx context.Context, key string) (*v1.ConfigItem, error)
	PutShared(ctx context.Context, key, content string, audit Audit) error
	DeleteShared(ctx context.Context, key string, audit Audit) error
	ListServices(ctx context.Context) ([]v1.ConfigItem, error)
	GetService(ctx context.Context, name string) (*v1.ConfigItem, error)
	PutService(ctx context.Context, name, content string, audit Audit) error
	DeleteService(ctx context.Context, name string, audit Audit) error
	Preview(ctx context.Context, name string) (string, error)
	Seed(ctx context.Context, dir string, force bool, audit Audit) (int, error)
	ListHistory(ctx context.Context, kind, key string) ([]v1.HistoryItem, error)
	Rollback(ctx context.Context, kind, key string, version int, audit Audit) (int, error)
}

var localConfig IConfig

func Config() IConfig {
	if localConfig == nil {
		panic("implement not found for interface IConfig, forgot register?")
	}
	return localConfig
}

func RegisterConfig(i IConfig) {
	localConfig = i
}
