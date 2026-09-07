package config

import "testing"

func TestShouldWriteBaseline(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name          string
		latestContent string
		hasLatest     bool
		prev          string
		want          bool
	}{
		{name: "empty prev", prev: "", hasLatest: false, want: false},
		{name: "history empty etcd has old", prev: "old:\n  a: 1\n", hasLatest: false, want: true},
		{name: "latest already old", prev: "old", latestContent: "old", hasLatest: true, want: false},
		{name: "latest is new missing old", prev: "old", latestContent: "new", hasLatest: true, want: true},
		{name: "whitespace prev", prev: "  \n", hasLatest: false, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := shouldWriteBaseline(tc.latestContent, tc.hasLatest, tc.prev)
			if got != tc.want {
				t.Fatalf("got %v want %v", got, tc.want)
			}
		})
	}
}
