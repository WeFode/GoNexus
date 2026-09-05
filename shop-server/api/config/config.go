// =================================================================================
// Code generated and maintained by GoFrame CLI tool. DO NOT EDIT.
// =================================================================================

package config

import (
	"context"

	"shop-server/api/config/v1"
)

type IConfigV1 interface {
	Runtime(ctx context.Context, req *v1.RuntimeReq) (res *v1.RuntimeRes, err error)
}
