package main

import "strings"

const defaultTerminalOutputLineLimit = 500
const defaultTerminalOutputCharacterLimit = 35000

func compressTerminalOutput(input string, lineLimit int, characterLimit int) string {
	processed := input
	processed = processCarriageReturns(processed)
	processed = processBackspaces(processed)
	return truncateTerminalOutput(applyRunLengthEncoding(processed), lineLimit, characterLimit)
}

func truncateTerminalOutput(content string, lineLimit int, characterLimit int) string {
	if lineLimit <= 0 && characterLimit <= 0 {
		return content
	}
	if characterLimit > 0 {
		runes := []rune(content)
		if len(runes) > characterLimit {
			beforeLimit := characterLimit / 5
			afterLimit := characterLimit - beforeLimit
			startSection := string(runes[:beforeLimit])
			endSection := string(runes[len(runes)-afterLimit:])
			omittedChars := len(runes) - characterLimit
			return startSection + "\n[..." + intToString(omittedChars) + " characters omitted...]\n" + endSection
		}
	}
	if lineLimit <= 0 {
		return content
	}
	lines := splitLinesKeepNewline(content)
	totalLines := len(lines)
	if totalLines <= lineLimit {
		return content
	}
	beforeLimit := lineLimit / 5
	afterLimit := lineLimit - beforeLimit
	startSection := strings.Join(lines[:beforeLimit], "")
	endSection := strings.Join(lines[totalLines-afterLimit:], "")
	omittedLines := totalLines - lineLimit
	return startSection + "\n[..." + intToString(omittedLines) + " lines omitted...]\n\n" + endSection
}

func applyRunLengthEncoding(content string) string {
	if content == "" {
		return content
	}
	lines := splitLinesKeepNewline(content)
	if len(lines) == 0 {
		return content
	}
	var result strings.Builder
	prevLine := lines[0]
	repeatCount := 0
	flush := func() {
		if repeatCount > 0 {
			compressionDesc := "<previous line repeated " + intToString(repeatCount) + " additional times>\n"
			if len(compressionDesc) < len(prevLine)*(repeatCount+1) {
				result.WriteString(prevLine)
				result.WriteString(compressionDesc)
			} else {
				for i := 0; i <= repeatCount; i++ {
					result.WriteString(prevLine)
				}
			}
			repeatCount = 0
			return
		}
		result.WriteString(prevLine)
	}
	for i := 1; i < len(lines); i++ {
		currentLine := lines[i]
		if currentLine == prevLine {
			repeatCount++
			continue
		}
		flush()
		prevLine = currentLine
	}
	flush()
	return result.String()
}

func processCarriageReturns(input string) string {
	if !strings.ContainsRune(input, '\r') {
		return input
	}
	lines := strings.Split(input, "\n")
	for i, line := range lines {
		lines[i] = processLineWithCarriageReturns(line)
	}
	return strings.Join(lines, "\n")
}

func processLineWithCarriageReturns(line string) string {
	segments := strings.Split(line, "\r")
	if len(segments) == 1 {
		return line
	}
	current := []rune(segments[0])
	for _, segment := range segments[1:] {
		if segment == "" {
			continue
		}
		segmentRunes := []rune(segment)
		if len(segmentRunes) >= len(current) {
			current = segmentRunes
			continue
		}
		next := append([]rune(nil), current...)
		copy(next, segmentRunes)
		current = next
	}
	return string(current)
}

func processBackspaces(input string) string {
	if !strings.ContainsRune(input, '\b') {
		return input
	}
	output := make([]rune, 0, len([]rune(input)))
	for _, ch := range input {
		if ch == '\b' {
			if len(output) > 0 {
				output = output[:len(output)-1]
			}
			continue
		}
		output = append(output, ch)
	}
	return string(output)
}

func splitLinesKeepNewline(content string) []string {
	if content == "" {
		return []string{}
	}
	lines := strings.SplitAfter(content, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func intToString(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var digits [20]byte
	index := len(digits)
	for value > 0 {
		index--
		digits[index] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		index--
		digits[index] = '-'
	}
	return string(digits[index:])
}