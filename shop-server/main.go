package main

import (
	_ "shop-server/internal/packed"

	_ "github.com/gogf/gf/contrib/drivers/pgsql/v2"
	_ "github.com/gogf/gf/contrib/nosql/redis/v2"

	_ "shop-server/internal/logic"

	"github.com/gogf/gf/v2/os/gctx"

	"shop-server/internal/cmd"
)

func main() {
	cmd.Main.Run(gctx.GetInitCtx())
}
