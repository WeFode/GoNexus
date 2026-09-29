package dockerx

import "testing"

func TestParsePublishedPorts(t *testing.T) {
	text := "0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp\n127.0.0.1:5433->5432/tcp\n"
	got := ParsePublishedPorts(text)
	if len(got) != 2 || got[0] != 5433 || got[1] != 8000 {
		t.Fatalf("%v", got)
	}
}

func TestSumMemUsage(t *testing.T) {
	text := "100MiB / 7.5GiB\n1GiB / 7.5GiB\n"
	got, err := SumMemUsage(text)
	if err != nil {
		t.Fatal(err)
	}
	want := int64(100*1024*1024 + 1024*1024*1024)
	if got != want {
		t.Fatalf("got %d want %d", got, want)
	}
	empty, err := SumMemUsage("")
	if err != nil || empty != 0 {
		t.Fatalf("empty %d %v", empty, err)
	}
}
