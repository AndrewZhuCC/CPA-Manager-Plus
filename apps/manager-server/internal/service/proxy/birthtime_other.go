//go:build !linux && !darwin

package proxy

import (
	"errors"
	"time"
)

func readFileBirthTime(string) (time.Time, error) {
	return time.Time{}, errors.New("file birth time is unsupported on this platform")
}
