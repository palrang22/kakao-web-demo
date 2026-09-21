# 샘플 인물 사진

Look Studio(02) 인물 선택 팝업(3×2)에 쓰는 샘플이다. 이 폴더에 아래 파일명 그대로 넣으면 된다.

```
woman_1.webp  woman_2.webp  woman_3.webp
man_1.webp    man_2.webp    man_3.webp
```

- 실제 배포 파일은 `.webp` (긴 변 1536px). PNG 로 새로 넣었으면 저장소 루트에서
  `pnpm optimize:samples` 를 돌리면 webp 로 변환되고 원본은 `samples-original/` 에 백업된다.
- 확장자는 `.webp` 고정 (`src/components/PersonPicker.tsx` 의 `sampleSrc()` 참고).
- 세로 인물 사진 권장 (썸네일이 3:4 로 잘린다). 전신 ~ 무릎 위 정도가 Virtual Try-On 결과가 좋다.
- 전시물이므로 **초상권/모델 릴리스가 확보된 이미지**만 쓸 것.
- 코드에서 `/samples/human/woman_1.webp` 같은 절대경로로 참조한다 (빌드 시 그대로 복사됨).
- 라벨(여성 1, 남성 2 …)을 바꾸려면 `PersonPicker.tsx` 의 `SAMPLE_PEOPLE` 를 수정.
