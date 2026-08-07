package transfer

const (
	defaultMaxPacketKiB       = 128
	defaultMaxRequestsPerFile = 16
	minMaxPacketKiB           = 32
	maxMaxPacketKiB           = 512
	minMaxRequestsPerFile     = 1
	maxMaxRequestsPerFile     = 1024
	sshChannelWindowBytes     = 64 * 32 * 1024
)

type Tuning struct {
	MaxPacketKiB        int
	MaxRequestsPerFile  int
	ConcurrentWrites    bool
	ApplyToSharedClient bool
	Configured          bool
}

func DefaultTuning() Tuning {
	return NormalizeTuning(Tuning{})
}

func NormalizeTuning(settings Tuning) Tuning {
	normalized := settings
	normalized.MaxPacketKiB = clamp(settings.MaxPacketKiB, minMaxPacketKiB, maxMaxPacketKiB, defaultMaxPacketKiB)
	normalized.MaxRequestsPerFile = clamp(settings.MaxRequestsPerFile, minMaxRequestsPerFile, maxMaxRequestsPerFile, defaultMaxRequestsPerFile)
	if !settings.Configured {
		normalized.ConcurrentWrites = true
		normalized.ApplyToSharedClient = true
	}
	return normalized
}

func clamp(value, minValue, maxValue, fallback int) int {
	if value <= 0 {
		return fallback
	}
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func WindowBoundedRequests(settings Tuning) int {
	settings = NormalizeTuning(settings)
	packetBytes := settings.MaxPacketKiB * 1024
	bounded := sshChannelWindowBytes / packetBytes
	if bounded < 1 {
		bounded = 1
	}
	if settings.MaxRequestsPerFile < bounded {
		return settings.MaxRequestsPerFile
	}
	return bounded
}
