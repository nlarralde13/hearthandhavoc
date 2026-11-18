from app.content import ContentError, validate_all_content


def main() -> int:
    try:
        route_ids = validate_all_content()
    except ContentError as exc:
        print(f"content validation failed: {exc}")
        return 1
    print(f"content validation passed: {len(route_ids)} route(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
