//go:build darwin

package proxy

import (
	"errors"
	"os"
	"syscall"
	"time"
)

func readFileBirthTime(path string) (time.Time, error) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Birthtimespec.Sec <= 0 {
		return time.Time{}, errors.New("file birth time is unavailable")
	}
	return time.Unix(stat.Birthtimespec.Sec, int64(stat.Birthtimespec.Nsec)), nil
}
