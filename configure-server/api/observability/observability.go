package observability

import (
	"context"

	"configure-server/api/observability/v1"
)

type IObservabilityV1 interface {
	Overview(ctx context.Context, req *v1.OverviewReq) (res *v1.OverviewRes, err error)
	Logs(ctx context.Context, req *v1.LogsReq) (res *v1.LogsRes, err error)
}
