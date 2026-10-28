package main

import (
	_ "time/tzdata" // scratch 镜像里没有 zoneinfo，嵌入后 TZ=Asia/Shanghai 才生效

	_ "configure-server/internal/packed"

	_ "github.com/gogf/gf/contrib/drivers/dm/v2"
	_ "github.com/gogf/gf/contrib/drivers/pgsql/v2"

	_ "configure-server/internal/logic"

	"github.com/gogf/gf/v2/os/gctx"

	"configure-server/internal/cmd"
)

func main() {
	cmd.Main.Run(gctx.GetInitCtx())
}
