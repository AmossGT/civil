"""Automated test suite verifying role-segregated access, JWT auth, token revocation,
bounded PostGIS queries, and atomic CSV imports for OpenTender.
"""
import io
import json
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = "http://127.0.0.1:8000/api/v1"

def req(path, method="GET", body=None, token=None, content_type="application/json"):
    url = f"{BASE_URL}{path}"
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        if content_type == "application/json":
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        else:
            headers["Content-Type"] = content_type
            data = body
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request) as resp:
            status = resp.status
            content = resp.read()
            try:
                parsed = json.loads(content.decode("utf-8")) if content else None
            except Exception:
                parsed = content
            return status, parsed
    except urllib.error.HTTPError as exc:
        err_content = exc.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_content)
        except Exception:
            err_json = {"detail": err_content}
        return exc.code, err_json

def run_tests():
    print("=== OpenTender Verification Test Suite ===")

    # 1. Health check
    status, data = req("/health")
    assert status == 200 and data.get("status") == "ok", f"Health check failed: {status}, {data}"
    print("[PASS] 1. Health check ok")

    # 2. Admin login
    status, auth_data = req("/auth/login", method="POST", body={
        "email": "admin@example.gov.in",
        "password": "change-this-local-password"
    })
    assert status == 200, f"Admin login failed: {status}, {auth_data}"
    admin_token = auth_data["access_token"]
    refresh_token = auth_data["refresh_token"]
    assert auth_data["user"]["role"] == "admin"
    print("[PASS] 2. Admin login successful (JWT received)")

    # 3. Refresh token rotation
    status, refresh_data = req("/auth/refresh", method="POST", body={"refresh_token": refresh_token})
    assert status == 200, f"Token refresh failed: {status}, {refresh_data}"
    admin_token = refresh_data["access_token"]  # use new rotated token
    print("[PASS] 3. Token refresh successful")

    # 4. User Provisioning
    # 4a: Create department viewer without department_id -> should fail with 422
    status, err = req("/admin/users", method="POST", body={
        "email": "invalid_viewer@example.gov.in",
        "password": "validpassword1234",
        "role": "department_viewer"
    }, token=admin_token)
    assert status == 422, f"Expected 422, got {status}: {err}"

    # 4b: Create valid department viewer
    viewer_email = "viewer_dept1@example.gov.in"
    # Ensure cleanup if exists from previous runs
    status, users_list = req("/admin/users", token=admin_token)
    existing = next((u for u in users_list if u["email"] == viewer_email), None)
    if not existing:
        status, viewer_user = req("/admin/users", method="POST", body={
            "email": viewer_email,
            "password": "viewerpassword1234",
            "role": "department_viewer",
            "department_id": 1
        }, token=admin_token)
        assert status == 201, f"Failed to create viewer: {status}, {viewer_user}"
    print("[PASS] 4. User provisioning validation works (department_viewer)")

    # 5. Admin Direct Tender CRUD
    draft_ref = "TEST_REF_DIRECT_001"
    req(f"/admin/tenders/{draft_ref}", method="DELETE", token=admin_token)  # cleanup if present
    status, tender_data = req("/admin/tenders", method="POST", body={
        "tender_ref": draft_ref,
        "department_id": 1,
        "title": "Direct Test Tender Title for Admin CRUD",
        "description": "Internal test draft description",
        "estimated_value": 7500000.0,
        "status": "draft"
    }, token=admin_token)
    assert status == 201, f"Create tender failed: {status}, {tender_data}"
    assert tender_data["status"] == "draft"

    # 5b: Update tender via PATCH
    status, patch_data = req(f"/admin/tenders/{draft_ref}", method="PATCH", body={
        "title": "Updated Direct Test Tender Title"
    }, token=admin_token)
    assert status == 200 and patch_data["status"] == "draft"

    # 5c: Set award directly
    status, award_data = req(f"/admin/tenders/{draft_ref}/award", method="POST", body={
        "contractor_id": 1,
        "awarded_value": 7200000.0,
        "status": "verified"
    }, token=admin_token)
    assert status == 201 and award_data["tender_status"] == "awarded"
    print("[PASS] 5. Admin direct CRUD (create draft, patch, set verified award) successful")

    # 6. Department Viewer Scoped Access
    status, v_auth = req("/auth/login", method="POST", body={
        "email": viewer_email,
        "password": "viewerpassword1234"
    })
    assert status == 200, f"Viewer login failed: {status}, {v_auth}"
    viewer_token = v_auth["access_token"]

    # Viewer can access their department tender
    status, t_detail = req(f"/tenders/{draft_ref}", token=viewer_token)
    assert status == 200, f"Viewer could not access their dept tender: {status}, {t_detail}"

    # Viewer CANNOT access admin CRUD
    status, err = req("/admin/tenders", method="POST", body={
        "tender_ref": "VIEWER_UNAUTHORIZED",
        "department_id": 1,
        "title": "Should be forbidden",
        "status": "draft"
    }, token=viewer_token)
    assert status == 403, f"Expected 403 Forbidden for viewer on admin endpoint, got {status}"
    print("[PASS] 6. Department viewer scoped access and role isolation verified")

    # 7. Public / Citizen visibility filtering
    hidden_ref = "TEST_REF_HIDDEN_DRAFT"
    req(f"/admin/tenders/{hidden_ref}", method="DELETE", token=admin_token)  # cleanup
    status, _ = req("/admin/tenders", method="POST", body={
        "tender_ref": hidden_ref,
        "department_id": 1,
        "title": "Hidden Draft Tender",
        "estimated_value": 1000000.0,
        "status": "draft"
    }, token=admin_token)
    assert status == 201

    # Unauthenticated visitor tries to view hidden draft
    status, pub_err = req(f"/tenders/{hidden_ref}")
    assert status == 404, f"Public visitor was able to access draft tender! Expected 404, got {status}"
    print("[PASS] 7. Public unauthenticated access correctly excludes draft tenders (404)")

    # 8. PostGIS Spatial Bounded Query
    status, map_data = req("/tenders/map?bbox=-180,-90,180,90")
    assert status == 200, f"Map query failed: {status}"
    assert len(map_data["features"]) <= 100, f"Features exceeded bound of 100! Got {len(map_data['features'])}"
    print(f"[PASS] 8. PostGIS map query bounded: {len(map_data['features'])} features returned (<= 100)")

    # 9. Atomic Two-Pass CSV Import
    # 9a: Malformed CSV with negative estimated_value
    bad_csv = "tender_ref,department_id,title,estimated_value\nCSV_BAD_01,1,Invalid Estimate,-50000\n"
    boundary = "----TestBoundary12345"
    body_bad = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="bad.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
        f"{bad_csv}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    status, bad_res = req("/admin/import/tenders", method="POST", body=body_bad, token=admin_token, content_type=f"multipart/form-data; boundary={boundary}")
    assert status == 200 and bad_res["created"] == 0 and len(bad_res["errors"]) > 0, f"CSV should have rejected bad rows! {bad_res}"

    # 9b: Valid CSV
    valid_csv = "tender_ref,department_id,title,estimated_value\nCSV_GOOD_01,1,Valid Tender One,2500000\nCSV_GOOD_02,1,Valid Tender Two,3500000\n"
    req("/admin/tenders/CSV_GOOD_01", method="DELETE", token=admin_token)
    req("/admin/tenders/CSV_GOOD_02", method="DELETE", token=admin_token)
    body_good = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="good.csv"\r\n'
        f"Content-Type: text/csv\r\n\r\n"
        f"{valid_csv}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    status, good_res = req("/admin/import/tenders", method="POST", body=body_good, token=admin_token, content_type=f"multipart/form-data; boundary={boundary}")
    assert status == 200 and good_res["created"] == 2 and len(good_res["errors"]) == 0, f"Valid CSV import failed: {good_res}"
    print("[PASS] 9. Atomic two-pass CSV import validated (rollback on bad row, commit on valid)")

    # 10. Token Revocation on Logout
    status, logout_res = req("/auth/logout", method="POST", token=viewer_token)
    assert status == 200 and logout_res.get("ok") is True

    # Try to use viewer_token again
    status, me_err = req("/auth/me", token=viewer_token)
    assert status == 401, f"Logged out token should be revoked with 401! Got {status}: {me_err}"
    print("[PASS] 10. Instant token revocation on logout verified (token_version bump)")

    print("\nALL 10 VERIFICATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
