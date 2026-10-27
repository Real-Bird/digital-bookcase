import html
import re
from urllib.parse import urljoin, urlparse


def normalize_isbn(value: str, allow_empty=False) -> str:
    value = re.sub(r'[\s-]', '', value).upper()
    if not value and allow_empty:
        return ''
    if value == '0000000000':
        raise ValueError('ISBN이 비어 있거나 잘못된 임시 값입니다.')
    if re.fullmatch(r'\d{9}[\dX]', value):
        if sum((10-i) * (10 if c == 'X' else int(c)) for i, c in enumerate(value)) % 11:
            raise ValueError('ISBN-10 체크섬이 올바르지 않습니다.')
        prefix = '978' + value[:9]
        return prefix + str((-sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(prefix))) % 10)
    if not re.fullmatch(r'(978|979)\d{10}', value) or value.startswith('9790'):
        raise ValueError('책의 ISBN-10 또는 978·979로 시작하는 ISBN-13을 입력하세요.')
    if sum(int(c) * (1 if i % 2 == 0 else 3) for i, c in enumerate(value)) % 10:
        raise ValueError('ISBN-13 체크섬이 올바르지 않습니다.')
    return value


def text(value):
    return html.unescape(re.sub(r'<[^>]*>', '', str(value or ''))).strip()


def parse_results(payload, isbn):
    if not isinstance(payload, dict):
        raise ValueError('도서관의 응답 형식을 확인할 수 없습니다.')
    if payload.get('errorCode'):
        code = str(payload['errorCode'])
        messages = {'010': 'API 키가 설정되지 않았습니다.', '011': 'API 키가 유효하지 않습니다.',
                    '012': '도서관의 검색결과 조회 한도를 초과했습니다.',
                    '013': 'API 분류 조건 오류입니다.', '014': 'API 검색 조건 오류입니다.',
                    '015': 'API 필수 검색 조건이 누락되었습니다.'}
        raise ValueError(messages.get(code, '도서관 검색 오류입니다. 잠시 후 다시 조회하세요.') + f' ({code})')
    items = payload.get('result') or []
    if not isinstance(items, list):
        raise ValueError('도서관의 결과 목록 형식이 올바르지 않습니다.')
    accepted = []
    rejected = 0
    mapping = {'titleInfo':'title', 'authorInfo':'author', 'pubInfo':'publisher',
               'pubYearInfo':'year', 'controlNo':'control_no', 'id':'nl_id',
               'callNo':'call_no', 'kdcCode1s':'kdc_code', 'kdcName1s':'kdc_name'}
    for item in items:
        raw = str(item.get('isbn') or '')
        matches = set()
        for candidate in re.findall(r'(?<!\d)(?:97[89][\d-]{10,16}|\d[\d-]{8,14}[\dXx])(?!\d)', raw):
            try:
                matches.add(normalize_isbn(candidate))
            except ValueError:
                pass
        if isbn not in matches:
            rejected += 1
            continue
        row = {target: text(item.get(source)) for source, target in mapping.items()}
        link = urljoin('https://www.nl.go.kr', str(item.get('detailLink') or ''))
        row.update(response_isbn=raw, detail_link=link if urlparse(link).scheme == 'https' and urlparse(link).hostname == 'www.nl.go.kr' else '',
                   isbn=isbn, source='국립중앙도서관', lookup_status='조회완료')
        accepted.append(row)
    return {'items': accepted, 'total': int(payload.get('total') or 0), 'rejected': rejected}
