from src.auth.hashing import hash_password, verify_password


def test_hash_password_returns_non_empty_string():
    hashed = hash_password("correct horse battery staple")
    assert isinstance(hashed, str)
    assert hashed != ""
    assert hashed != "correct horse battery staple"


def test_hash_password_is_salted_each_time():
    a = hash_password("same-password")
    b = hash_password("same-password")
    assert a != b


def test_verify_password_matches_original():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", hashed) is True


def test_verify_password_rejects_wrong_password():
    hashed = hash_password("correct horse battery staple")
    assert verify_password("wrong-password", hashed) is False
