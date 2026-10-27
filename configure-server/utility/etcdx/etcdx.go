package etcdx

import "configure-center/pkg/etcdcfg"

var client *etcdcfg.Client

func Set(c *etcdcfg.Client) {
	client = c
}

func Client() *etcdcfg.Client {
	if client == nil {
		panic("etcd client 未初始化")
	}
	return client
}
