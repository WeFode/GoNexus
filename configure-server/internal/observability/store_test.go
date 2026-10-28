package observability

import (
	"testing"
	"time"
)

func TestStoreQueryOrderAndFilters(t *testing.T) {
	s := NewStore(3)
	s.Add(Entry{Source: SourceServer, Message: "one"})
	s.Add(Entry{Source: SourceAccess, Level: LevelWarn, Message: "two", Status: 404})
	s.Add(Entry{Source: SourceAccess, Level: LevelError, Message: "three", User: "alice"})
	s.Add(Entry{Source: SourceDeploy, Message: "four", NodeId: "win-local"})

	items, lastId := s.Query(Filter{})
	if len(items) != 3 {
		t.Fatalf("expected 3 items after ring overwrite, got %d", len(items))
	}
	if items[0].Message != "two" || items[2].Message != "four" {
		t.Fatalf("unexpected order: %+v", items)
	}
	if lastId != items[2].Id {
		t.Fatalf("lastId %d != %d", lastId, items[2].Id)
	}
	if items[0].Time == "" || items[0].Ts == 0 {
		t.Fatalf("entry time not filled: %+v", items[0])
	}

	errs, _ := s.Query(Filter{Level: LevelError})
	if len(errs) != 1 || errs[0].User != "alice" {
		t.Fatalf("level filter failed: %+v", errs)
	}

	keyword, _ := s.Query(Filter{Keyword: "WIN"})
	if len(keyword) != 1 || keyword[0].NodeId != "win-local" {
		t.Fatalf("keyword filter failed: %+v", keyword)
	}

	after, _ := s.Query(Filter{AfterId: items[1].Id})
	if len(after) != 1 || after[0].Id != items[2].Id {
		t.Fatalf("afterId filter failed: %+v", after)
	}

	stat := s.Stat()
	if stat.Capacity != 3 || stat.Size != 3 || stat.Total != 4 {
		t.Fatalf("unexpected buffer stat: %+v", stat)
	}
}

func TestStoreServiceFilterAndStats(t *testing.T) {
	s := NewStore(10)
	ts := time.Now().Add(-time.Minute).UnixMilli()
	s.Add(Entry{Service: "shop-server", Message: "boot", Ts: ts})
	s.Add(Entry{Service: "shop-server", Source: SourceAccess, Message: "GET /api/v1/products 200"})
	s.Add(Entry{Message: "local"})

	items, _ := s.Query(Filter{Service: "shop-server"})
	if len(items) != 2 {
		t.Fatalf("expected 2 shop-server entries, got %d", len(items))
	}
	if items[0].Ts != ts {
		t.Fatalf("remote timestamp not preserved: %d != %d", items[0].Ts, ts)
	}

	local, _ := s.Query(Filter{Service: LocalService})
	if len(local) != 1 || local[0].Message != "local" {
		t.Fatalf("local service filter failed: %+v", local)
	}

	s.TouchService("deploy-agent")
	stats := s.ServiceStats()
	if len(stats) != 3 {
		t.Fatalf("expected 3 services, got %+v", stats)
	}
	if stats[0].Name != LocalService {
		t.Fatalf("local service should be first: %+v", stats)
	}
	seen := map[string]ServiceStat{}
	for _, st := range stats {
		seen[st.Name] = st
	}
	if seen["shop-server"].Count != 2 || seen["deploy-agent"].SeenAt == 0 {
		t.Fatalf("unexpected service stats: %+v", stats)
	}
}

func TestStoreSubscribe(t *testing.T) {
	s := NewStore(10)
	id, ch := s.Subscribe()
	defer s.Unsubscribe(id)

	emitted := s.Add(Entry{Message: "live"})
	select {
	case got := <-ch:
		if got.Id != emitted.Id || got.Message != "live" {
			t.Fatalf("unexpected event: %+v", got)
		}
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for live event")
	}

	if stat := s.Stat(); stat.Clients != 1 {
		t.Fatalf("expected 1 subscriber, got %d", stat.Clients)
	}
}

func TestStoreTruncatesLongMessage(t *testing.T) {
	s := NewStore(1)
	long := make([]rune, maxMessageRunes+50)
	for i := range long {
		long[i] = '日'
	}
	s.Add(Entry{Message: string(long)})
	items, _ := s.Query(Filter{Limit: 1})
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	got := []rune(items[0].Message)
	if len(got) != maxMessageRunes+1 || got[maxMessageRunes] != '…' {
		t.Fatalf("message not truncated, len=%d", len(got))
	}
}

func TestLevelFromFormat(t *testing.T) {
	cases := map[string]string{
		"DEBU": LevelDebug,
		"INFO": LevelInfo,
		"NOTI": LevelInfo,
		"WARN": LevelWarn,
		"ERRO": LevelError,
		"CRIT": LevelError,
	}
	for in, want := range cases {
		if got := levelFromFormat(in); got != want {
			t.Fatalf("levelFromFormat(%q) = %q, want %q", in, got, want)
		}
	}
}
